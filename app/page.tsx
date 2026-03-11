"use client";

import React, { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Upload, 
  FileJson, 
  Download, 
  Copy, 
  Check, 
  Trash2, 
  AlertCircle,
  FileText,
  ShieldCheck
} from "lucide-react";

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [jsonData, setJsonData] = useState<any>(null);
  const [format, setFormat] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      if (droppedFile.name.endsWith(".dat") || droppedFile.type === "application/octet-stream") {
        setFile(droppedFile);
        setError(null);
      } else {
        setError("Please upload a .dat file");
      }
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setJsonData(null);
      setError(null);
    }
  };

  const processFile = async () => {
    if (!file) return;

    setLoading(true);
    setError(null);
    
    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await fetch("/api/convert", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "Failed to convert file");
      }

      const data = await response.json();
      // If it comes from our robust converter, it has a 'data' field
      setJsonData(data.data || data);
      if (data.format) setFormat(data.format);
      if (data.note) setNote(data.note);
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = () => {
    if (!jsonData) return;
    navigator.clipboard.writeText(JSON.stringify(jsonData, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadJson = () => {
    if (!jsonData) return;
    const blob = new Blob([JSON.stringify(jsonData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${file?.name.replace(".dat", "") || "data"}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const reset = () => {
    setFile(null);
    setJsonData(null);
    setFormat(null);
    setNote(null);
    setError(null);
  };

  return (
    <main className="min-h-screen py-20 px-4 md:px-10 lg:px-20 max-w-7xl mx-auto flex flex-col items-center">
      {/* Header Section */}
      <motion.div 
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center mb-16"
      >
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-sm font-medium mb-6">
          <ShieldCheck size={16} />
          Safe, Secure & Local Processing
        </div>
        <h1 className="text-5xl md:text-7xl font-bold mb-6 tracking-tight bg-gradient-to-b from-white to-white/60 bg-clip-text text-transparent">
          DAT to JSON <br />
          <span className="text-blue-500">Transmuter</span>
        </h1>
        <p className="text-xl text-gray-400 max-w-2xl mx-auto">
          Convert legacy .dat files to modern, structured JSON in seconds. 
          Support for CSV-like formatting, plain text, and nested structures.
        </p>
      </motion.div>

      <div className="w-full grid grid-cols-1 lg:grid-cols-2 gap-12 items-start">
        {/* Upload Side */}
        <motion.div 
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className="glass-card p-8 flex flex-col gap-8 h-full min-h-[500px]"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-semibold flex items-center gap-2">
              <Upload size={24} className="text-blue-500" />
              Upload Source
            </h2>
            {file && (
              <button onClick={reset} className="text-gray-400 hover:text-red-400 transition-colors">
                <Trash2 size={20} />
              </button>
            )}
          </div>

          {!jsonData && !loading ? (
            <div 
              onDragOver={handleDragOver}
              onDrop={onDrop}
              className={`flex-1 border-2 border-dashed rounded-2xl flex flex-col items-center justify-center gap-4 transition-all duration-300 ${file ? 'border-blue-500/50 bg-blue-500/5' : 'border-white/10 hover:border-white/20 hover:bg-white/[0.02]'}`}
            >
              <input 
                type="file" 
                id="file-upload" 
                className="hidden" 
                accept=".dat" 
                onChange={handleFileChange}
              />
              <label htmlFor="file-upload" className="cursor-pointer flex flex-col items-center gap-4 group">
                <div className="w-20 h-20 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                  <FileText size={40} className={file ? 'text-blue-500' : 'text-gray-500'} />
                </div>
                <div className="text-center">
                  <p className="text-lg font-medium">
                    {file ? file.name : "Drag & drop your .dat file here"}
                  </p>
                  <p className="text-sm text-gray-500 mt-1">
                    {file ? `${(file.size / 1024).toFixed(2)} KB` : "or click to browse your computer"}
                  </p>
                </div>
              </label>
              
              {file && (
                <button 
                  onClick={processFile}
                  className="button-primary mt-4"
                >
                  Convert Now
                </button>
              )}
            </div>
          ) : loading ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-6">
              <div className="relative w-24 h-24">
                <div className="absolute inset-0 border-4 border-blue-500/20 rounded-full"></div>
                <div className="absolute inset-0 border-4 border-t-blue-500 rounded-full animate-spin"></div>
              </div>
              <div className="text-center">
                <p className="text-xl font-medium animate-pulse">Transmuting Data...</p>
                <p className="text-sm text-gray-400 mt-2">Parsing structure and mapping objects</p>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-6 bg-blue-500/5 border border-blue-500/20 rounded-2xl p-8">
              <div className="w-20 h-20 rounded-full bg-blue-500 flex items-center justify-center shadow-[0_0_30px_rgba(0,112,243,0.5)]">
                <Check size={40} className="text-white" />
              </div>
              <div className="text-center">
                <h3 className="text-2xl font-bold">Conversion Complete!</h3>
                <p className="text-gray-400 mt-2">Your data is ready for preview and export.</p>
              </div>
              <button 
                onClick={reset}
                className="button-secondary w-full"
              >
                Upload Another File
              </button>
            </div>
          )}

          {error && (
            <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-start gap-3 text-red-400 animate-fade-in">
              <AlertCircle size={20} className="shrink-0 mt-0.5" />
              <p className="text-sm">{error}</p>
            </div>
          )}
        </motion.div>

        {/* Preview Side */}
        <motion.div 
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          className="glass-card p-8 flex flex-col gap-6 h-full min-h-[500px]"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-semibold flex items-center gap-2">
              <FileJson size={24} className="text-blue-500" />
              JSON Preview
              {format && (
                <span className="text-[10px] uppercase tracking-widest bg-blue-500/10 text-blue-400 px-2 py-1 rounded border border-blue-500/20 ml-2">
                  {format}
                </span>
              )}
            </h2>
            <div className="flex gap-2">
              {jsonData && (
                <>
                  <button 
                    onClick={copyToClipboard}
                    className="p-2 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition-colors text-gray-400"
                    title="Copy to clipboard"
                  >
                    {copied ? <Check size={20} className="text-green-500" /> : <Copy size={20} />}
                  </button>
                  <button 
                    onClick={downloadJson}
                    className="p-2 rounded-lg bg-blue-500 border border-blue-600 hover:bg-blue-400 transition-colors text-white"
                    title="Download JSON"
                  >
                    <Download size={20} />
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="flex-1 relative overflow-hidden rounded-xl bg-black/40 border border-white/5">
            <AnimatePresence mode="wait">
              {jsonData ? (
                <motion.div
                  key="data"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="h-full overflow-auto p-6"
                >
                  {note && (
                    <div className="mb-4 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg text-xs text-blue-400 flex items-center gap-2">
                       <AlertCircle size={14} />
                       {note}
                    </div>
                  )}
                  <pre className="text-sm text-blue-300 leading-relaxed">
                    {JSON.stringify(jsonData, null, 2)}
                  </pre>
                </motion.div>
              ) : (
                <motion.div
                  key="empty"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="h-full flex flex-col items-center justify-center p-8 text-center text-gray-500"
                >
                  <div className="w-16 h-16 rounded-full border-2 border-dashed border-white/10 flex items-center justify-center mb-4">
                    <FileJson size={32} />
                  </div>
                  <p>Convert a file to see the <br />JSON structure here</p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      </div>

      {/* Footer Info */}
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
        className="mt-20 pt-10 border-t border-white/5 w-full text-center text-gray-500 text-sm"
      >
        Built with Next.js • Framer Motion • Lucide React
      </motion.div>

      <style jsx global>{`
        .bg-clip-text {
          -webkit-background-clip: text;
        }
      `}</style>
    </main>
  );
}
