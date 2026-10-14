import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Lightbulb, ChevronLeft, ChevronRight, Shield, Smartphone, Printer, Box } from 'lucide-react';

const FACTS = [
  {
    icon: Printer,
    title: "Print Attacks & Color Artifacts",
    tag: "Physical Spoof",
    content: "Printed photo attacks (on paper, photo-glossy paper, or posters) lack natural 3D facial curvature. Under ambient lighting, paper fibers produce characteristic specular highlights and diffuse scattering, which AENet detects using its auxiliary pseudo-depth and surface reflection heads."
  },
  {
    icon: Smartphone,
    title: "Screen Replay Attacks & Moiré Patterns",
    tag: "Digital Replay",
    content: "When a webcam records a smartphone, tablet, or monitor display, high-frequency spatial interference creates subtle 'moiré fringes' and subpixel grid artifacts. AENet's multi-scale convolutional filters detect these frequency domain anomalies even when invisible to the human eye."
  },
  {
    icon: Box,
    title: "3D Latex & Resin Masks",
    tag: "3D Presentation Attack",
    content: "3D realistic silicone or latex masks mimic coarse head geometry, but fail at microscopic skin elasticity, thermal absorption, and micro-pore reflectivity. In CelebA-Spoof, 3D masks form attack category #10, evaluated under distinct illumination spectra."
  },
  {
    icon: Shield,
    title: "Why Liveness Detection is Essential",
    tag: "Biometric Security",
    content: "Standard face recognition only checks 'who you look like'—meaning a stolen photo can bypass it. Face Anti-Spoofing (Presentation Attack Detection / ISO 30107-3) verifies 'that you are physically present and living', preventing identity fraud in banking and access control."
  }
];

export const DidYouKnow: React.FC = () => {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setIndex((prev) => (prev + 1) % FACTS.length);
    }, 7000);
    return () => clearInterval(timer);
  }, []);

  const current = FACTS[index];
  const IconComponent = current.icon;

  return (
    <div className="glass-panel rounded-2xl p-5 border border-slate-800 relative overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center space-x-2 text-xs font-bold text-amber-400">
          <Lightbulb className="w-4 h-4 text-amber-400 animate-pulse" />
          <span className="uppercase tracking-wider">Did You Know?</span>
        </div>
        <div className="flex items-center space-x-1">
          <button
            onClick={() => setIndex((prev) => (prev - 1 + FACTS.length) % FACTS.length)}
            className="p-1 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white transition"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <span className="text-[10px] text-slate-500 font-mono px-1">
            {index + 1}/{FACTS.length}
          </span>
          <button
            onClick={() => setIndex((prev) => (prev + 1) % FACTS.length)}
            className="p-1 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white transition"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Rotating Fact Content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={index}
          initial={{ opacity: 0, x: 10 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -10 }}
          transition={{ duration: 0.3 }}
          className="space-y-2"
        >
          <div className="flex items-center space-x-2">
            <span className="p-1.5 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-cyan-400">
              <IconComponent className="w-4 h-4" />
            </span>
            <h4 className="text-xs font-bold text-white">{current.title}</h4>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-medium">
              {current.tag}
            </span>
          </div>
          <p className="text-xs text-slate-300 leading-relaxed">
            {current.content}
          </p>
        </motion.div>
      </AnimatePresence>
    </div>
  );
};
