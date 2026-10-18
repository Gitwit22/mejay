import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { installAudioUnlockOnFirstGesture } from "./lib/audioEngine";

installAudioUnlockOnFirstGesture();

// The unverified client-side license prototype was removed; drop any tokens it stored.
try {
  localStorage.removeItem("mejay_license_state");
} catch {
  // ignore
}

createRoot(document.getElementById("root")!).render(<App />);
