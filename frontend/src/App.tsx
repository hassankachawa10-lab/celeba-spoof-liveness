import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldCheck, LogOut, Activity, BarChart2, Video } from 'lucide-react';
import { LoginPortal } from './components/LoginPortal';
import { LiveDetection } from './components/LiveDetection';
import { DidYouKnow } from './components/DidYouKnow';
import { ModelBenchmark } from './components/ModelBenchmark';
import { PredictionResult } from './types';

export const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'detection' | 'benchmark'>('detection');
  const [lastResult, setLastResult] = useState<PredictionResult | null>(null);

  if (!currentUser) {
    return <LoginPortal onLoginSuccess={(username) => setCurrentUser(username)} />;
  }

  return (
    <div className="min-h-screen flex flex-col relative overflow-x-hidden selection:bg-cyan-500/20 selection:text-cyan-300">
      {/* Web3 Animated Background Mesh */}
      <div className="mesh-gradient" />

      {/* Top Application Header */}
      <header className="glass-panel sticky top-0 z-50 border-b border-slate-800/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          {/* Logo & Platform Info */}
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
              <ShieldCheck className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-sm font-bold tracking-tight text-white flex items-center gap-2">
                CelebA-Spoof <span className="text-cyan-400 font-extrabold">Studio</span>
              </h1>
              <p className="text-[11px] text-slate-400 font-mono">
                AENet ECCV 2020 &bull; Biometric Liveness Verification
              </p>
            </div>
          </div>

          {/* Nav Tabs & User Profile */}
          <div className="flex items-center space-x-4">
            <div className="hidden sm:flex bg-slate-900/90 p-1 rounded-xl border border-slate-800 text-xs">
              <button
                onClick={() => setActiveTab('detection')}
                className={`px-3 py-1.5 rounded-lg font-semibold transition-all flex items-center gap-1.5 ${
                  activeTab === 'detection'
                    ? 'bg-cyan-500 text-slate-950 shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Video className="w-3.5 h-3.5" />
                <span>Live Verification</span>
              </button>
              <button
                onClick={() => setActiveTab('benchmark')}
                className={`px-3 py-1.5 rounded-lg font-semibold transition-all flex items-center gap-1.5 ${
                  activeTab === 'benchmark'
                    ? 'bg-cyan-500 text-slate-950 shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <BarChart2 className="w-3.5 h-3.5" />
                <span>Benchmark Analytics</span>
              </button>
            </div>

            {/* User Session Pill */}
            <div className="flex items-center space-x-2 pl-2 border-l border-slate-800 text-xs">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <span className="text-slate-300 font-medium hidden md:inline">
                {currentUser}
              </span>
              <button
                onClick={() => setCurrentUser(null)}
                title="Sign Out"
                className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-red-500/20 hover:text-red-300 text-slate-400 transition"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8 space-y-8">
        <AnimatePresence mode="wait">
          {activeTab === 'detection' ? (
            <motion.div
              key="detection-tab"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.25 }}
              className="space-y-8"
            >
              {/* Rotating Did You Know Fact Panel */}
              <DidYouKnow />

              {/* Core Live Detection Component */}
              <LiveDetection onPredictionUpdate={(res) => setLastResult(res)} />

              {/* Integrated Benchmark Overview at bottom */}
              <ModelBenchmark />
            </motion.div>
          ) : (
            <motion.div
              key="benchmark-tab"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.25 }}
              className="space-y-8"
            >
              <ModelBenchmark />
              <DidYouKnow />
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800/80 py-5 text-center text-xs text-slate-500 glass-panel">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>CelebA-Spoof Face Anti-Spoofing &bull; ECCV 2020 Multi-Task Auxiliary Network</span>
          <span className="font-mono text-slate-600 text-[11px]">Production Full-Stack Architecture</span>
        </div>
      </footer>
    </div>
  );
};
