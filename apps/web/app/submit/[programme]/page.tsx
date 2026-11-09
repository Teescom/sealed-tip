"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { type Programme, createViewClient } from "@sealedtip/core";
import { type RedactionBundle } from "@sealedtip/crypto";

import { createTipApi } from "@/lib/api";
import { readPublicConfig, type PublicConfig } from "@/lib/config";
import { domCanvasHost } from "@/lib/dom-canvas-host";
import {
  submitTipFlow,
  type FileInput,
  type SubmitProgressStep,
  type SubmitTipFlowResult,
} from "@/lib/submit-flow";

import { AttestationPanel } from "@/components/AttestationPanel";
import { RecoveryWords } from "@/components/RecoveryWords";
import { RecusalPicker } from "@/components/RecusalPicker";
import { RedactionReview } from "@/components/RedactionReview";
import { SwitchSettings } from "@/components/SwitchSettings";

interface SelectedFile {
  file: File;
  scanMode: boolean;
}

export default function SubmitPage({
  params,
}: {
  params: Promise<{ programme: string }>;
}) {
  const unwrappedParams = use(params);
  const programmeIdNum = Number.parseInt(unwrappedParams.programme, 10);

  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [configProblems, setConfigProblems] = useState<readonly string[] | null>(null);
  const [programme, setProgramme] = useState<Programme | null>(null);
  const [programmeLoading, setProgrammeLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Form State
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<SelectedFile[]>([]);
  const [recused, setRecused] = useState<string[]>([]);

  // Switch State
  const [switchArmed, setSwitchArmed] = useState(false);
  const [switchConfig, setSwitchConfig] = useState({
    interval: "7",
    grace: "2",
    includesRaw: false,
  });

  // AI Redaction State
  const [aiRunning, setAiRunning] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiBundle, setAiBundle] = useState<RedactionBundle | null>(null);
  const [aiSuggestions, setAiSuggestions] = useState<
    Array<{ span: string; reason: string; replacement: string }>
  >([]);
  const [aiNonce, setAiNonce] = useState<string | null>(null);
  const [aiModel, setAiModel] = useState<string | null>(null);

  // Submission State
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<SubmitProgressStep | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submissionResult, setSubmissionResult] = useState<SubmitTipFlowResult | null>(null);

  useEffect(() => {
    const env = {
      NEXT_PUBLIC_NEAR_NETWORK: process.env.NEXT_PUBLIC_NEAR_NETWORK,
      NEXT_PUBLIC_NEAR_RPC_URL: process.env.NEXT_PUBLIC_NEAR_RPC_URL,
      NEXT_PUBLIC_SEALEDTIP_CONTRACT: process.env.NEXT_PUBLIC_SEALEDTIP_CONTRACT,
      NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
      NEXT_PUBLIC_TOKEN_CONTRACT: process.env.NEXT_PUBLIC_TOKEN_CONTRACT,
    };
    const res = readPublicConfig(env);
    if (!res.ok) {
      setConfigProblems(res.problems);
      setProgrammeLoading(false);
      return;
    }
    setConfig(res.config);

    if (Number.isNaN(programmeIdNum)) {
      setLoadError(`"${unwrappedParams.programme}" is not a valid programme number`);
      setProgrammeLoading(false);
      return;
    }

    const views = createViewClient(res.config.rpcUrl, res.config.contractId);
    views
      .getProgramme(programmeIdNum)
      .then((p) => {
        if (!p) {
          setLoadError(`Programme #${programmeIdNum} was not found on-chain.`);
        } else {
          setProgramme(p);
        }
      })
      .catch((err) => {
        setLoadError(`Failed to load programme: ${err instanceof Error ? err.message : String(err)}`);
      })
      .finally(() => setProgrammeLoading(false));
  }, [programmeIdNum, unwrappedParams.programme]);

  const handleAddFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const added: SelectedFile[] = Array.from(e.target.files).map((file) => ({
      file,
      scanMode: false,
    }));
    setSelectedFiles((prev) => [...prev, ...added]);
    e.target.value = "";
  };

  const handleRemoveFile = (index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleToggleScanMode = (index: number) => {
    setSelectedFiles((prev) =>
      prev.map((f, i) => (i === index ? { ...f, scanMode: !f.scanMode } : f)),
    );
  };

  const handleRunAiRedaction = async () => {
    if (!config || !description.trim()) return;
    setAiRunning(true);
    setAiError(null);

    try {
      const api = createTipApi(config.apiUrl);
      // Generate 32 bytes of lowercase hex for nonce
      const nonceBytes = new Uint8Array(32);
      crypto.getRandomValues(nonceBytes);
      const nonceHex = Array.from(nonceBytes, (b) => b.toString(16).padStart(2, "0")).join("");

      const res = await api.redact({
        text: description,
        nonce: nonceHex,
      });

      if (!res.ok) {
        setAiError(res.error);
        return;
      }

      const body = res.value as {
        result?: {
          bundle: RedactionBundle;
          suggestions: Array<{ span: string; reason: string; replacement: string }> | null;
          model: string;
        };
      };

      if (!body.result) {
        setAiError("Received unexpected response from AI redaction service.");
        return;
      }

      setAiBundle(body.result.bundle);
      setAiSuggestions(body.result.suggestions ?? []);
      setAiNonce(nonceHex);
      setAiModel(body.result.model);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : String(err));
    } finally {
      setAiRunning(false);
    }
  };

  const handleAcceptSuggestion = (idx: number) => {
    const s = aiSuggestions[idx];
    if (!s) return;
    setDescription((prev) => prev.replaceAll(s.span, s.replacement));
    setAiSuggestions((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleRejectSuggestion = (idx: number) => {
    setAiSuggestions((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!programme || !config) return;

    setSubmitting(true);
    setSubmitError(null);
    setProgress(null);

    try {
      const api = createTipApi(config.apiUrl);
      const host = domCanvasHost();
      const views = createViewClient(config.rpcUrl, config.contractId);

      const files: FileInput[] = selectedFiles.map((sf) => ({
        name: sf.file.name,
        blob: sf.file,
        scanMode: sf.scanMode,
      }));

      const rawFiles = switchConfig.includesRaw
        ? selectedFiles.map((sf) => ({ name: sf.file.name, blob: sf.file }))
        : undefined;

      const aiInput =
        aiBundle && aiNonce
          ? {
              originalText: description,
              finalText: description,
              suggestions: aiSuggestions,
              residualRisks: [],
              unparsed: null,
              model: aiModel || "near-ai",
              nonce: aiNonce,
              bundle: aiBundle,
            }
          : undefined;

      const switchInput = switchArmed
        ? {
            intervalDays: Number.parseInt(switchConfig.interval, 10) || 7,
            graceDays: Number.parseInt(switchConfig.grace, 10) || 2,
            includesRaw: switchConfig.includesRaw,
          }
        : undefined;

      const result = await submitTipFlow(
        {
          programme,
          title,
          description,
          files,
          rawFiles,
          recused,
          aiRedaction: aiInput,
          deadMansSwitch: switchInput,
          onProgress: (p) => setProgress(p),
        },
        {
          api,
          canvasHost: host,
          getKeeperInfo: () => views.getKeeperInfo(),
        },
      );

      setSubmissionResult(result);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (programmeLoading) {
    return (
      <main className="max-w-3xl mx-auto px-4 py-12 text-neutral-300">
        <div className="animate-pulse flex flex-col gap-4">
          <div className="h-8 bg-neutral-800 rounded w-1/3"></div>
          <div className="h-4 bg-neutral-800 rounded w-2/3"></div>
          <div className="h-32 bg-neutral-900 rounded"></div>
        </div>
      </main>
    );
  }

  if (configProblems && configProblems.length > 0) {
    return (
      <main className="max-w-3xl mx-auto px-4 py-12 text-neutral-300">
        <h1 className="text-xl font-bold text-red-400 mb-4">Deployment Configuration Error</h1>
        <div className="rounded-lg border border-red-800 bg-red-950/20 p-4 text-sm text-red-200">
          <ul className="list-disc pl-5 space-y-1">
            {configProblems.map((prob, i) => (
              <li key={i}>{prob}</li>
            ))}
          </ul>
        </div>
      </main>
    );
  }

  if (loadError || !programme) {
    return (
      <main className="max-w-3xl mx-auto px-4 py-12 text-neutral-300">
        <h1 className="text-xl font-bold text-red-400 mb-2">Programme Not Found</h1>
        <p className="text-sm text-neutral-400 mb-4">{loadError}</p>
        <Link href="/" className="text-xs text-sky-400 underline">
          ← Back to open programmes
        </Link>
      </main>
    );
  }

  if (submissionResult) {
    return (
      <main className="max-w-3xl mx-auto px-4 py-12 text-neutral-200">
        <div className="rounded-xl border border-emerald-800 bg-emerald-950/30 p-6 space-y-6">
          <div className="flex items-center gap-2 text-emerald-400 font-bold text-xl">
            <span>✓ Tip Submitted Successfully</span>
          </div>

          <p className="text-sm text-neutral-300">
            Your tip has been encrypted in your browser and accepted by the relayer queue. It will be submitted on-chain with random timing delay to protect against network correlation attacks.
          </p>

          <RecoveryWords words={submissionResult.secretWords} />

          <div className="bg-black/50 p-4 rounded-lg font-mono text-xs space-y-2 border border-neutral-800">
            <div>
              <span className="text-neutral-500">Evidence CID: </span>
              <span className="text-emerald-400">{submissionResult.evidenceCid}</span>
            </div>
            <div>
              <span className="text-neutral-500">Queued Until: </span>
              <span className="text-neutral-300">
                {new Date(submissionResult.queuedUntil).toLocaleString()}
              </span>
            </div>
          </div>

          <div className="flex gap-4 pt-2">
            <Link
              href="/status"
              className="px-4 py-2 bg-emerald-700 hover:bg-emerald-600 rounded text-white text-sm font-medium transition-colors"
            >
              Go to Status Page
            </Link>
            <Link
              href={`/p/${programme.id}`}
              className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 rounded text-neutral-300 text-sm font-medium transition-colors"
            >
              Back to Programme
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const panelAccounts = programme.panel.map((m) => m.account);

  return (
    <main className="max-w-3xl mx-auto px-4 py-12 text-neutral-200">
      <div className="mb-6">
        <Link href={`/p/${programme.id}`} className="text-xs text-sky-400 hover:underline">
          ← Back to {programme.title}
        </Link>
        <h1 className="text-2xl font-bold text-white mt-2">Submit Anonymous Tip</h1>
        <div className="mt-1 flex flex-wrap gap-4 text-xs text-neutral-400">
          <span>Programme #{programme.id}</span>
          <span>Max Reward: {programme.max_reward}</span>
          <span>Panel: {programme.panel.length} members</span>
          <span>PoW: {programme.pow_bits} bits</span>
        </div>
      </div>

      <div className="mb-6 rounded-lg border border-sky-900/40 bg-sky-950/20 p-3 text-xs text-sky-300">
        🛡️ <span className="font-semibold">Privacy Promise:</span> You have no account. Your browser cleans metadata, encrypts evidence with local keys, and relays your tip through privacy proxies.
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Title & Description */}
        <div className="space-y-4">
          <div>
            <label htmlFor="tip-title" className="block text-sm font-medium text-neutral-300 mb-1">
              Tip Title <span className="text-red-400">*</span>
            </label>
            <input
              id="tip-title"
              type="text"
              required
              maxLength={200}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Accounting fraud in procurement division"
              className="w-full min-h-[44px] bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-sky-500"
            />
          </div>

          <div>
            <div className="flex flex-wrap justify-between items-center gap-2 mb-1">
              <label htmlFor="tip-description" className="block text-sm font-medium text-neutral-300">
                Detailed Narrative <span className="text-red-400">*</span>
              </label>
              {description.trim().length > 0 && (
                <button
                  type="button"
                  onClick={handleRunAiRedaction}
                  disabled={aiRunning}
                  aria-label="Run AI privacy check with verifiable TEE attestation"
                  className="min-h-[44px] px-3 py-1.5 text-xs text-purple-400 hover:text-purple-300 font-medium flex items-center gap-1 rounded-lg hover:bg-purple-950/30 transition-colors cursor-pointer"
                >
                  {aiRunning ? "Analyzing..." : "✨ Run AI Privacy Check"}
                </button>
              )}
            </div>
            <textarea
              id="tip-description"
              required
              rows={6}
              maxLength={200000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Provide full details. What happened, who was involved, and which files prove it."
              className="w-full bg-neutral-900 border border-neutral-700 rounded-lg p-3 text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-sky-500 font-sans"
            />
            <p className="text-[11px] text-neutral-500 mt-1">
              Be cautious of stylometry or unique details that only you could know.
            </p>
          </div>
        </div>

        {/* AI Redaction review if available */}
        {aiError && (
          <div role="alert" className="text-xs text-red-400 bg-red-950/20 p-3 rounded-lg border border-red-800/40">
            AI Redaction Error: {aiError}
          </div>
        )}
        {aiBundle && (
          <div className="space-y-3">
            <AttestationPanel bundleHash={aiBundle.nonce} model={aiModel ?? undefined} nonce={aiNonce ?? undefined} />
            <RedactionReview
              suggestions={aiSuggestions}
              onAccept={handleAcceptSuggestion}
              onReject={handleRejectSuggestion}
            />
          </div>
        )}

        {/* Evidence Files */}
        <div className="space-y-3">
          <label className="block text-sm font-medium text-neutral-300">
            Evidence Files (PDF, PNG, JPEG)
          </label>
          <div className="border border-dashed border-neutral-700 rounded-xl p-6 text-center bg-neutral-950/30">
            <input
              type="file"
              multiple
              accept="application/pdf,image/png,image/jpeg"
              onChange={handleAddFiles}
              className="hidden"
              id="file-upload"
            />
            <label
              htmlFor="file-upload"
              className="min-h-[44px] px-4 py-2.5 inline-flex items-center justify-center cursor-pointer text-sm text-sky-400 hover:text-sky-300 font-semibold rounded-lg hover:bg-sky-950/30 transition-colors"
            >
              Choose files to clean &amp; upload
            </label>
            <p className="text-xs text-neutral-500 mt-1">
              PDFs are rasterised to eliminate revision history. Images are re-encoded without EXIF.
            </p>
          </div>

          {selectedFiles.length > 0 && (
            <div className="space-y-2 mt-3">
              {selectedFiles.map((sf, idx) => (
                <div
                  key={idx}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-lg border border-neutral-800 bg-neutral-900/60 text-xs"
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="font-mono text-neutral-200 break-all">{sf.file.name}</span>
                    <span className="text-neutral-500">
                      ({(sf.file.size / 1024).toFixed(1)} KB)
                    </span>
                    <label className="min-h-[44px] flex items-center gap-2 cursor-pointer text-neutral-300 hover:text-white">
                      <input
                        type="checkbox"
                        checked={sf.scanMode}
                        onChange={() => handleToggleScanMode(idx)}
                        className="w-4 h-4 rounded border-neutral-700 text-sky-500 focus:ring-sky-500 cursor-pointer"
                      />
                      <span>Photocopier scan mode</span>
                    </label>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveFile(idx)}
                    aria-label={`Remove file ${sf.file.name}`}
                    className="min-h-[44px] min-w-[70px] px-3 py-2 text-red-400 hover:text-red-300 rounded-lg hover:bg-red-950/30 font-medium flex items-center justify-center cursor-pointer shrink-0 border border-red-900/40 sm:border-0"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Panel Recusal */}
        <RecusalPicker panel={panelAccounts} value={recused} onChange={setRecused} />

        {/* Dead Man's Switch */}
        <SwitchSettings
          value={switchConfig}
          onChange={setSwitchConfig}
          enabled={switchArmed}
          onToggle={setSwitchArmed}
        />

        {/* Progress or Errors */}
        {progress && (
          <div className="rounded-lg border border-sky-800/40 bg-sky-950/20 p-4 text-xs text-sky-300 space-y-1">
            <div className="font-semibold uppercase tracking-wider text-[11px] text-sky-400">
              Step: {progress.phase}
            </div>
            {progress.phase === "cleaning" && (
              <div>Cleaning file {progress.current} of {progress.total} locally in browser...</div>
            )}
            {progress.phase === "reporting" && <div>Building stripped metadata report...</div>}
            {progress.phase === "sealing" && <div>Encrypting exhibit bundle with XChaCha20-Poly1305...</div>}
            {progress.phase === "uploading-evidence" && <div>Uploading ciphertext blob to storage...</div>}
            {progress.phase === "sealing-keys" && (
              <div>Sealing key to panel member {progress.current} of {progress.total}...</div>
            )}
            {progress.phase === "mining-pow" && (
              <div>Solving proof-of-work puzzle ({programme.pow_bits} bits)...</div>
            )}
            {progress.phase === "signing" && <div>Signing submit transaction with derived Ed25519 key...</div>}
            {progress.phase === "relaying" && <div>Relaying submission to relayer queue...</div>}
          </div>
        )}

        {submitError && (
          <div className="p-3 rounded-lg border border-red-800 bg-red-950/30 text-xs text-red-300">
            Submission Failed: {submitError}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full py-3 bg-sky-600 hover:bg-sky-500 disabled:bg-neutral-800 disabled:text-neutral-500 text-white rounded-lg font-medium text-sm transition-colors cursor-pointer disabled:cursor-not-allowed"
        >
          {submitting ? "Processing & Encrypting Tip..." : "Submit Anonymous Tip"}
        </button>
      </form>
    </main>
  );
}
