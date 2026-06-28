import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, HashRouter, Route, Routes } from "react-router-dom";
import App from "./pages/App.jsx";
import Room from "./pages/Room.jsx";
import "./styles.css";

const Router = window.syncwatchDesktop?.isDesktop || window.location.protocol === "file:"
  ? HashRouter
  : BrowserRouter;

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Router>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/room/:roomId" element={<Room />} />
      </Routes>
    </Router>
  </React.StrictMode>
);
