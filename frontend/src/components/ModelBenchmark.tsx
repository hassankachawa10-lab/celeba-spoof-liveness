import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { BarChart3, Database, Cpu, Layers, AlertCircle, CheckCircle2, Activity } from 'lucide-react';
import { BenchmarkData } from '../types';
import { apiUrl } from '../config';

interface ModelBenchmarkProps {
  initialBenchmark?: BenchmarkData | null;
}

export const ModelBenchmark: React.FC<ModelBenchmarkProps> = ({ initialBenchmark }) => {
  const [benchmark, setBenchmark] = useState<BenchmarkData | null>(initialBenchmark || null);
  const [loading, setLoading] = useState<boolean>(!initialBenchmark);

  useEffect(() => {
    if (!benchmark) {
      fetch(apiUrl('/benchmark'))
        .then((res) => res.json())
        .then((data) => {
          setBenchmark(data);
          setLoading(false);
        })
        .catch((err) => {
          console.warn('Could not fetch /benchmark from backend:', err);
          setLoading(false);
        });
    }
  }, [benchmark]);

  if (loading || !benchmark) {
    return (
      <div className="glass-panel rounded-3xl p-6 text-center text-xs text-slate-400">
        Loading benchmark evaluation metrics...
      </div>
    );
  }

  const { model_metadata, evaluation_summary, spoof_type_breakdown, illumination_breakdown } = benchmark;

  return (
    <section className="space-y-6">
      {/* Section Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-4">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-cyan-400" />
            <span>Model & Empirical Benchmark</span>
          </h2>
          <p className="text-xs text-slate-400">
            Real measured results on CelebA-Spoof dataset split &bull; AENet ResNet-18 Backbone
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <span className="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 font-mono">
            {evaluation_summary.latency.mean_ms_per_frame} ms/frame ({evaluation_summary.latency.fps} FPS)
          </span>
          <span className="px-2.5 py-1 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-cyan-400 font-semibold">
            Device: {evaluation_summary.latency.device.toUpperCase()}
          </span>
        </div>
      </div>

      {/* Top KPI Metrics Cards Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="glass-panel p-4 rounded-2xl border border-slate-800">
          <span className="text-[11px] font-semibold text-slate-400 uppercase">Test Accuracy</span>
          <div className="text-2xl font-black text-cyan-400 mt-1">
            {evaluation_summary.accuracy.toFixed(1)}%
          </div>
          <p className="text-[10px] text-slate-500 mt-0.5">Overall verification accuracy</p>
        </div>

        <div className="glass-panel p-4 rounded-2xl border border-slate-800">
          <span className="text-[11px] font-semibold text-slate-400 uppercase">APCER (Spoof Error)</span>
          <div className="text-2xl font-black text-amber-400 mt-1">
            {evaluation_summary.apcer.toFixed(1)}%
          </div>
          <p className="text-[10px] text-slate-500 mt-0.5">Attack Presentation Error Rate</p>
        </div>

        <div className="glass-panel p-4 rounded-2xl border border-slate-800">
          <span className="text-[11px] font-semibold text-slate-400 uppercase">BPCER (Live Error)</span>
          <div className="text-2xl font-black text-emerald-400 mt-1">
            {evaluation_summary.bpcer.toFixed(1)}%
          </div>
          <p className="text-[10px] text-slate-500 mt-0.5">Bona Fide Presentation Error Rate</p>
        </div>

        <div className="glass-panel p-4 rounded-2xl border border-slate-800">
          <span className="text-[11px] font-semibold text-slate-400 uppercase">TPR @ FPR = 1.0%</span>
          <div className="text-2xl font-black text-indigo-400 mt-1">
            {evaluation_summary.tpr_at_fpr_1_0_pct.toFixed(1)}%
          </div>
          <p className="text-[10px] text-slate-500 mt-0.5">Paper benchmark standard (10E-2)</p>
        </div>
      </div>

      {/* Two Column Layout: Specifications & Attack Breakdowns */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Model Architecture Specifications (5 Cols) */}
        <div className="lg:col-span-5 glass-panel p-5 rounded-2xl border border-slate-800 space-y-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
            <Layers className="w-4 h-4 text-cyan-400" />
            <span>Architecture & Preprocessing Protocol</span>
          </h3>

          <div className="space-y-2 text-xs divide-y divide-slate-800/80">
            <div className="pt-2 flex justify-between">
              <span className="text-slate-400">Architecture</span>
              <span className="font-semibold text-white font-mono">{model_metadata.architecture}</span>
            </div>
            <div className="pt-2 flex justify-between">
              <span className="text-slate-400">Framework</span>
              <span className="font-semibold text-white font-mono">{model_metadata.framework}</span>
            </div>
            <div className="pt-2 flex justify-between">
              <span className="text-slate-400">Input Resolution</span>
              <span className="font-semibold text-white font-mono">{model_metadata.input_resolution} RGB</span>
            </div>
            <div className="pt-2 flex justify-between">
              <span className="text-slate-400">Normalization</span>
              <span className="font-semibold text-slate-300 text-right max-w-[200px] truncate">
                ToTensor() [0.0, 1.0]
              </span>
            </div>
            <div className="pt-2 flex justify-between">
              <span className="text-slate-400">Face Crop Margin</span>
              <span className="font-semibold text-emerald-400 font-mono">0 Margin (Direct BBox)</span>
            </div>
            <div className="pt-2 flex justify-between">
              <span className="text-slate-400">Trained Best Prec</span>
              <span className="font-semibold text-cyan-400 font-mono">
                {model_metadata.trained_accuracy_checkpoint.toFixed(2)}%
              </span>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800 text-[11px] text-slate-400 space-y-1">
            <div className="font-semibold text-slate-300 flex items-center gap-1">
              <Database className="w-3.5 h-3.5 text-indigo-400" />
              <span>Full CelebA-Spoof Dataset Reference:</span>
            </div>
            <p>
              625,537 images from 10,177 subjects with 43 semantic attributes, 11 attack types, and auxiliary 3D geometric supervision.
            </p>
          </div>
        </div>

        {/* Right: Attack Breakdown & Weakness Flags (7 Cols) */}
        <div className="lg:col-span-7 space-y-4">
          <div className="glass-panel p-5 rounded-2xl border border-slate-800 space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Activity className="w-4 h-4 text-cyan-400" />
                <span>Performance Breakdown by Spoof Attack Form</span>
              </span>
              <span className="text-[10px] text-slate-400 font-mono">Empirical Test</span>
            </h3>

            {/* Attack Type Breakdown Bars */}
            <div className="space-y-3">
              {Object.entries(spoof_type_breakdown).map(([attackName, stats]) => {
                const isWeak = stats.accuracy < 60;
                return (
                  <div key={attackName} className="space-y-1">
                    <div className="flex justify-between text-xs font-medium">
                      <span className="text-slate-200 flex items-center gap-1.5">
                        <span>{attackName}</span>
                        {isWeak && (
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 font-semibold border border-amber-500/30">
                            Weaker Detection
                          </span>
                        )}
                      </span>
                      <span className="font-mono text-slate-400">
                        {stats.accuracy.toFixed(1)}% accuracy ({stats.samples} sample{stats.samples > 1 ? 's' : ''})
                      </span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-slate-900 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-700 ${
                          stats.accuracy >= 80 ? 'bg-emerald-500' : isWeak ? 'bg-amber-500' : 'bg-cyan-500'
                        }`}
                        style={{ width: `${stats.accuracy}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Robustness Warning Flag */}
            <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300 flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 text-amber-400 mt-0.5" />
              <div className="space-y-1 text-[11px]">
                <strong className="text-amber-200 block">Robustness Alert & Weak Spot Identification:</strong>
                <p>
                  High-quality matte physical photo prints under diffuse daylight exhibit lower reflection contrast than glossy smartphone displays. To maintain zero false accepts in production, the decision threshold should be set to <strong>0.45–0.48</strong> when verifying printed paper attacks.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Mandatory Benchmark Note */}
      <p className="text-center text-xs text-slate-500 italic">
        "Measured on CelebA-Spoof test split; real-world results vary with lighting, camera and display quality."
      </p>
    </section>
  );
};
