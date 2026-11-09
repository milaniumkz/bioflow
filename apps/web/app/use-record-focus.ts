"use client";
import { RefObject, useEffect } from "react";

// Wait for the scanner dialog to close, then scroll the actual scroll container
// (including an embedded record drawer) rather than assuming window scrolling.
export function useRecordFocus(
  ref: RefObject<HTMLElement | null>,
  request: unknown,
) {
  useEffect(() => {
    if (!request) return;
    let frame = 0,
      attempts = 0;
    const reveal = () => {
      const node = ref.current;
      if (!node) return;
      const dialogs =
        document.querySelectorAll<HTMLDialogElement>("dialog[open]");
      const top = dialogs.item(dialogs.length - 1);
      if (top && !top.contains(node)) {
        if (++attempts < 120) frame = requestAnimationFrame(reveal);
        return;
      }
      node.focus({ preventScroll: true });
      node.scrollIntoView({
        block: "start",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
      });
    };
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(reveal);
    });
    return () => cancelAnimationFrame(frame);
  }, [ref, request]);
}
