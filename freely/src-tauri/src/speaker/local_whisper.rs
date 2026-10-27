use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter, Manager};
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum WhisperModel {
    TinyEn,
    BaseEn,
    SmallEn,
}

impl WhisperModel {
    pub fn from_id(id: &str) -> Result<Self, String> {
        match id {
            "tiny.en" => Ok(Self::TinyEn),
            "base.en" => Ok(Self::BaseEn),
            "small.en" => Ok(Self::SmallEn),
            other => Err(format!("Unknown Whisper model: {}", other)),
        }
    }

    pub fn filename(&self) -> &str {
        match self {
            Self::TinyEn => "ggml-tiny.en.bin",
            Self::BaseEn => "ggml-base.en.bin",
            Self::SmallEn => "ggml-small.en.bin",
        }
    }

    pub fn download_url(&self) -> String {
        format!(
            "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/{}",
            self.filename()
        )
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WhisperStatus {
    pub initialized: bool,
    pub model: Option<String>,
    pub model_path: Option<String>,
}

/// Whether a model is loaded; checked by the capture loop without touching
/// the engine mutex, which a running transcription may hold for a while.
static ENGINE_READY: AtomicBool = AtomicBool::new(false);
/// Whether the capture loop should emit live partial transcripts.
static LIVE_TRANSCRIPTION: AtomicBool = AtomicBool::new(false);

pub fn live_transcription_active() -> bool {
    ENGINE_READY.load(Ordering::Acquire) && LIVE_TRANSCRIPTION.load(Ordering::Acquire)
}

pub struct WhisperEngine {
    context: Option<WhisperContext>,
    model_name: Option<String>,
    model_path: Option<PathBuf>,
}

impl WhisperEngine {
    pub fn new() -> Self {
        Self {
            context: None,
            model_name: None,
            model_path: None,
        }
    }

    pub fn init(&mut self, model_path: PathBuf) -> Result<(), String> {
        let params = WhisperContextParameters::default();
        let ctx = WhisperContext::new_with_params(
            model_path.to_str().ok_or("Invalid model path")?,
            params,
        )
        .map_err(|e| format!("Failed to load Whisper model: {}", e))?;

        let model_name = model_path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("unknown")
            .to_string();

        self.context = Some(ctx);
        self.model_name = Some(model_name);
        self.model_path = Some(model_path);
        Ok(())
    }

    pub fn transcribe(&self, audio_f32: &[f32], sample_rate: u32) -> Result<String, String> {
        if sample_rate != 16000 {
            return Err(format!(
                "Unsupported sample rate {}; Whisper requires 16000 Hz",
                sample_rate
            ));
        }
        let ctx = self.context.as_ref().ok_or("Whisper not initialized")?;
        let mut state = ctx
            .create_state()
            .map_err(|e| format!("Failed to create state: {}", e))?;

        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        params.set_language(Some("en"));
        params.set_n_threads(4);
        params.set_print_special(false);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);
        params.set_no_timestamps(true);
        params.set_single_segment(true);
        params.set_no_context(true);
        params.set_suppress_blank(true);
        params.set_suppress_non_speech_tokens(true);

        // Whisper needs at least 1 s of audio; pad short clips with silence
        let mut padded;
        let audio = if audio_f32.len() < 16000 {
            padded = audio_f32.to_vec();
            padded.resize(16000 + 1600, 0.0);
            &padded[..]
        } else {
            audio_f32
        };

        state
            .full(params, audio)
            .map_err(|e| format!("Transcription failed: {}", e))?;

        let num_segments = state
            .full_n_segments()
            .map_err(|e| format!("Failed to get segments: {}", e))?;
        let mut text = String::new();
        for i in 0..num_segments {
            if let Ok(segment) = state.full_get_segment_text_lossy(i) {
                text.push_str(&segment);
            }
        }

        Ok(text.trim().to_string())
    }

    pub fn status(&self) -> WhisperStatus {
        WhisperStatus {
            initialized: self.context.is_some(),
            model: self.model_name.clone(),
            model_path: self
                .model_path
                .as_ref()
                .map(|p| p.to_string_lossy().to_string()),
        }
    }
}

/// Downmix-free resample of mono audio to 16 kHz (box-filter average for
/// downsampling, linear interpolation otherwise). Good enough for speech.
pub fn resample_to_16k(samples: &[f32], sample_rate: u32) -> Vec<f32> {
    if sample_rate == 16000 || samples.is_empty() {
        return samples.to_vec();
    }
    let ratio = sample_rate as f64 / 16000.0;
    let out_len = (samples.len() as f64 / ratio).floor() as usize;
    let mut out = Vec::with_capacity(out_len);
    for i in 0..out_len {
        let start = i as f64 * ratio;
        if ratio > 1.0 {
            let s = start.floor() as usize;
            let e = ((start + ratio).floor() as usize)
                .min(samples.len())
                .max(s + 1);
            let sum: f32 = samples[s..e].iter().sum();
            out.push(sum / (e - s) as f32);
        } else {
            let s = start.floor() as usize;
            let frac = (start - s as f64) as f32;
            let a = samples[s];
            let b = *samples.get(s + 1).unwrap_or(&a);
            out.push(a + (b - a) * frac);
        }
    }
    out
}

/// Transcribe 16 kHz mono audio with the loaded model. Blocking: call it from
/// `spawn_blocking`, never from an async task or the audio loop.
pub fn transcribe_blocking(app: &AppHandle, samples_16k: &[f32]) -> Result<String, String> {
    let state = app.state::<crate::WhisperState>();
    let slot = state.engine.lock();
    let engine = slot
        .as_ref()
        .ok_or("Whisper engine not initialized; load a model first")?;
    engine.transcribe(samples_16k, 16000)
}

fn models_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("No app data dir: {}", e))?
        .join("whisper-models");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create models dir: {}", e))?;
    Ok(dir)
}

#[derive(Debug, Clone, Serialize)]
pub struct WhisperModelInfo {
    pub model: String,
    pub downloaded: bool,
    pub path: String,
    pub size_bytes: u64,
    pub loaded: bool,
}

#[tauri::command]
pub async fn get_local_whisper_model(
    app: AppHandle,
    model: String,
) -> Result<WhisperModelInfo, String> {
    let m = WhisperModel::from_id(&model)?;
    let path = models_dir(&app)?.join(m.filename());
    let size_bytes = std::fs::metadata(&path).map(|md| md.len()).unwrap_or(0);
    let loaded = {
        let state = app.state::<crate::WhisperState>();
        let slot = state.engine.lock();
        slot.as_ref()
            .and_then(|e| e.model_path.clone())
            .map(|p| p == path)
            .unwrap_or(false)
    };
    Ok(WhisperModelInfo {
        model,
        downloaded: size_bytes > 0,
        path: path.to_string_lossy().to_string(),
        size_bytes,
        loaded,
    })
}

#[derive(Clone, Serialize)]
struct DownloadProgress {
    model: String,
    downloaded: u64,
    total: u64,
}

/// Download a ggml Whisper model into the app data dir, emitting
/// `whisper-model-download-progress` events along the way.
#[tauri::command]
pub async fn download_local_whisper_model(app: AppHandle, model: String) -> Result<String, String> {
    let m = WhisperModel::from_id(&model)?;
    let dir = models_dir(&app)?;
    let dest = dir.join(m.filename());
    if dest.exists() {
        return Ok(dest.to_string_lossy().to_string());
    }
    let part = dir.join(format!("{}.part", m.filename()));

    let response = reqwest::get(m.download_url())
        .await
        .map_err(|e| format!("Download failed: {}", e))?
        .error_for_status()
        .map_err(|e| format!("Download failed: {}", e))?;
    let total = response.content_length().unwrap_or(0);

    let mut file =
        std::fs::File::create(&part).map_err(|e| format!("Failed to create file: {}", e))?;
    let mut downloaded: u64 = 0;
    let mut last_emit: u64 = 0;
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| {
            let _ = std::fs::remove_file(&part);
            format!("Download interrupted: {}", e)
        })?;
        file.write_all(&chunk).map_err(|e| {
            let _ = std::fs::remove_file(&part);
            format!("Failed to write model: {}", e)
        })?;
        downloaded += chunk.len() as u64;
        if downloaded - last_emit > 2 * 1024 * 1024 || downloaded == total {
            last_emit = downloaded;
            let _ = app.emit(
                "whisper-model-download-progress",
                DownloadProgress {
                    model: model.clone(),
                    downloaded,
                    total,
                },
            );
        }
    }
    file.flush()
        .map_err(|e| format!("Failed to write model: {}", e))?;
    drop(file);
    std::fs::rename(&part, &dest).map_err(|e| format!("Failed to save model: {}", e))?;
    Ok(dest.to_string_lossy().to_string())
}

/// Load a downloaded model (no-op if it is already the loaded one).
#[tauri::command]
pub async fn load_local_whisper_model(app: AppHandle, model: String) -> Result<(), String> {
    let m = WhisperModel::from_id(&model)?;
    let path = models_dir(&app)?.join(m.filename());
    if !path.exists() {
        return Err(format!("Model {} is not downloaded", model));
    }
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<crate::WhisperState>();
        let mut slot = state.engine.lock();
        let engine = slot.get_or_insert_with(WhisperEngine::new);
        if engine.model_path.as_ref() == Some(&path) && engine.context.is_some() {
            return Ok(());
        }
        engine.init(path)?;
        ENGINE_READY.store(true, Ordering::Release);
        Ok(())
    })
    .await
    .map_err(|e| format!("Model load task failed: {}", e))?
}

/// Turn live partial transcripts during system audio capture on or off.
#[tauri::command]
pub fn set_live_transcription(enabled: bool) {
    LIVE_TRANSCRIPTION.store(enabled, Ordering::Release);
}

#[tauri::command]
pub async fn init_local_whisper(app: AppHandle, model_path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<crate::WhisperState>();
        let mut slot = state.engine.lock();
        let engine = slot.get_or_insert_with(WhisperEngine::new);
        engine.init(PathBuf::from(model_path))?;
        ENGINE_READY.store(true, Ordering::Release);
        Ok(())
    })
    .await
    .map_err(|e| format!("Model load task failed: {}", e))?
}

#[tauri::command]
pub async fn transcribe_local(app: AppHandle, audio_b64: String) -> Result<String, String> {
    use base64::{engine::general_purpose::STANDARD as B64, Engine as _};

    let wav_bytes = B64
        .decode(&audio_b64)
        .map_err(|e| format!("Base64 decode error: {}", e))?;
    let reader = hound::WavReader::new(std::io::Cursor::new(wav_bytes))
        .map_err(|e| format!("WAV decode error: {}", e))?;
    let spec = reader.spec();
    let channels = spec.channels.max(1) as usize;
    let interleaved: Vec<f32> = match spec.sample_format {
        hound::SampleFormat::Int => reader
            .into_samples::<i32>()
            .filter_map(|s| s.ok())
            .map(|s| s as f32 / (1i64 << (spec.bits_per_sample - 1)) as f32)
            .collect(),
        hound::SampleFormat::Float => reader
            .into_samples::<f32>()
            .filter_map(|s| s.ok())
            .collect(),
    };
    let mono: Vec<f32> = interleaved
        .chunks(channels)
        .map(|frame| frame.iter().sum::<f32>() / frame.len() as f32)
        .collect();
    let samples = resample_to_16k(&mono, spec.sample_rate);

    // Whisper is CPU/GPU-heavy: keep it off the async runtime's worker threads
    tauri::async_runtime::spawn_blocking(move || transcribe_blocking(&app, &samples))
        .await
        .map_err(|e| format!("Transcription task failed: {}", e))?
}

#[tauri::command]
pub async fn get_local_whisper_status(app: AppHandle) -> Result<WhisperStatus, String> {
    let state = app.state::<crate::WhisperState>();
    let slot = state.engine.lock();
    Ok(slot.as_ref().map(|e| e.status()).unwrap_or(WhisperStatus {
        initialized: false,
        model: None,
        model_path: None,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resample_48k_to_16k_divides_length_by_three() {
        let samples = vec![0.5f32; 48000];
        let out = resample_to_16k(&samples, 48000);
        assert_eq!(out.len(), 16000);
        assert!(out.iter().all(|s| (s - 0.5).abs() < 1e-6));
    }

    #[test]
    fn resample_16k_is_identity() {
        let samples = vec![0.1f32, -0.2, 0.3];
        assert_eq!(resample_to_16k(&samples, 16000), samples);
    }

    #[test]
    fn resample_44_1k_length() {
        let samples = vec![0.0f32; 44100];
        assert_eq!(resample_to_16k(&samples, 44100).len(), 16000);
    }

    #[test]
    fn model_ids_parse() {
        assert!(WhisperModel::from_id("base.en").is_ok());
        assert!(WhisperModel::from_id("large").is_err());
    }
}
