import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { installAudioUnlockOnFirstGesture } from "./lib/audioEngine";

installAudioUnlockOnFirstGesture();

createRoot(document.getElementById("root")!).render(<App />);
