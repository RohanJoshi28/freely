import { describe, expect, it } from "vitest";
import {
  localTurnVerdict,
  parseResetHeader,
  parseVerdict,
} from "../turn-judge.function";

describe("localTurnVerdict", () => {
  it.each([
    "Yeah.",
    "Right, right.",
    "Okay, sounds good.",
    "Mm-hmm.",
    "Totally.",
    "That makes sense.",
  ])("skips acknowledgement %s", (text) => {
    expect(localTurnVerdict(text)).toBe("skip");
  });

  it.each([
    "So the next thing I want to ask you about is, um,",
    "And the reason I left Google was mostly because",
    "So my question is",
    "And what I'd want to see is how you'd handle the",
    "Imagine engagement drops ten percent overnight,",
  ])("waits on unfinished %s", (text) => {
    expect(localTurnVerdict(text)).toBe("wait");
  });

  it.each([
    "Can you tell me about a time you disagreed with a teammate?",
    "Why?",
    "Tell me more.",
    "Design a URL shortener like bitly.",
    "So I started in banking and after two years I moved to a startup.",
  ])("leaves %s to the model", (text) => {
    expect(localTurnVerdict(text)).toBeNull();
  });
});

describe("parseVerdict", () => {
  it("reads the first label in any case or wrapping", () => {
    expect(parseVerdict("RESPOND")).toBe("respond");
    expect(parseVerdict("**Skip**")).toBe("skip");
    expect(parseVerdict("wait.")).toBe("wait");
    expect(parseVerdict("I think so")).toBeNull();
  });
});

describe("parseResetHeader", () => {
  it("parses Groq durations and plain seconds", () => {
    expect(parseResetHeader("14m24s")).toBe(864_000);
    expect(parseResetHeader("1.5s")).toBe(1_500);
    expect(parseResetHeader("120ms")).toBe(120);
    expect(parseResetHeader("30")).toBe(30_000);
    expect(parseResetHeader(null)).toBeNull();
    expect(parseResetHeader("soon")).toBeNull();
  });
});
