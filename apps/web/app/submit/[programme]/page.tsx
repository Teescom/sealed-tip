"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { type Programme, createViewClient } from "@sealedtip/core";
import { type RedactionBundle } from "@sealedtip/crypto";

import { createTipApi } from "@/lib/api";
import { readPublicConfig, type PublicConfig } from "@/lib/config";
import { domCanvasHost } from "@/lib/dom-canvas-host";
import { formatTokenAmount } from "@/app/p/[id]/page";
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
      <div className="mx-auto w-full max-w-3xl px-4 py-12">
        <div className="flex flex-col gap-4" role="status" aria-label="Loading programme">
          <div className="h-8 w-1/3 rounded-inset bg-ground-3"></div>
          <div className="h-4 w-2/3 rounded-inset bg-ground-3"></div>
          <div className="h-32 rounded-inset bg-ground-3"></div>
        </div>
      </div>
    );
  }

  if (configProblems && configProblems.length > 0) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-12">
        <div className="card on-paper p-6">
          <h1 className="display mb-4 text-2xl text-bad">Deployment configuration error</h1>
          <div className="border-l-4 border-l-bad bg-paper p-4 text-sm text-bad">
            <ul className="list-disc space-y-1 pl-5">
              {configProblems.map((prob, i) => (
                <li key={i}>{prob}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    );
  }

  if (loadError || !programme) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-12">
        <div className="card on-paper p-6">
        <h1 className="display mb-2 text-2xl text-bad">Programme not found</h1>
        <p className="mb-4 text-sm text-ink-muted">{loadError}</p>
        <Link href="/" className="inline-flex min-h-[44px] items-center text-sm text-ask underline">
          Back to open programmes
        </Link>
        </div>
      </div>
    );
  }

  if (submissionResult) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-12">
        <div className="card on-paper p-6 sm:p-8">
          <div className="card-inset space-y-6 p-5">
            <h1 className="display text-2xl text-ok">Tip submitted</h1>

            <p className="text-sm leading-relaxed text-ink-muted">
              Your tip was encrypted in your browser and accepted by the relayer queue. It goes on chain after a
              random delay, which is what stops someone watching the chain from lining your submission up with
              their own traffic.
            </p>

            <RecoveryWords words={submissionResult.secretWords} />

            <dl className="card-inset space-y-2 p-4 text-xs">
              <div className="flex flex-wrap justify-between gap-2">
                <dt className="text-ink-muted">Evidence CID</dt>
                <dd className="datum text-ok">{submissionResult.evidenceCid}</dd>
              </div>
              <div className="flex flex-wrap justify-between gap-2">
                <dt className="text-ink-muted">Queued until</dt>
                <dd className="datum text-ink-muted">
                  {new Date(submissionResult.queuedUntil).toLocaleString()}
                </dd>
              </div>
            </dl>

            <div className="flex flex-wrap gap-3 pt-1">
              <Link
                href="/status"
                className="btn-primary inline-flex min-h-[44px] items-center px-4 text-sm no-underline"
              >
                Go to status
              </Link>
              <Link
                href={`/p/${programme.id}`}
                className="rounded-field inline-flex min-h-[44px] items-center px-4 text-sm text-ink no-underline hover:bg-paper-3"
              >
                Back to programme
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const panelAccounts = programme.panel.map((m) => m.account);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <div className="card on-paper space-y-6 p-5 sm:p-8">
      <div>
        <Link
          href={`/p/${programme.id}`}
          className="inline-flex min-h-[44px] items-center text-sm text-ask no-underline hover:underline"
        >
          Back to {programme.title}
        </Link>
        <h1 className="display mt-1 text-[clamp(1.75rem,5vw,2.25rem)] text-ask">Submit a tip</h1>
        <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-2 border-t border-rule pt-3 text-xs">
          <div className="flex gap-2">
            <dt className="text-ink-muted">Programme</dt>
            <dd className="datum text-ink">#{programme.id}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-ink-muted">Max reward</dt>
            <dd className="datum text-ink">{formatTokenAmount(programme.max_reward)}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-ink-muted">Panel</dt>
            <dd className="datum text-ink">{programme.panel.length} members</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-ink-muted">Proof of work</dt>
            <dd className="datum text-ink">{programme.pow_bits} bits</dd>
          </div>
        </dl>
      </div>

      <div className="card-inset p-4 text-xs leading-relaxed text-ink-muted">
        <span className="font-semibold text-ink">Privacy promise:</span> You have no account. Your browser cleans
        the metadata, encrypts the evidence with keys that never leave this page, and hands the signed submission
        to a relayer so the request on chain is not yours.
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Title & Description */}
        <div className="space-y-4">
          <div>
            <label htmlFor="tip-title" className="block text-sm font-medium text-ink-muted mb-1">
              Tip Title <span className="text-bad">*</span>
            </label>
            <input
              id="tip-title"
              type="text"
              required
              maxLength={200}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Accounting fraud in procurement division"
              className="w-full min-h-[44px] bg-paper border border-edge rounded-field px-3 py-2 text-sm text-ink placeholder:text-ink-muted"
            />
          </div>

          <div>
            <div className="flex flex-wrap justify-between items-center gap-2 mb-1">
              <label htmlFor="tip-description" className="block text-sm font-medium text-ink-muted">
                Detailed Narrative <span className="text-bad">*</span>
              </label>
              {description.trim().length > 0 && (
                <button
                  type="button"
                  onClick={handleRunAiRedaction}
                  disabled={aiRunning}
                  aria-label="Check the narrative for identity-revealing phrases in the enclave"
                  className="btn-secondary shrink-0 px-3.5 text-xs disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {aiRunning ? "Checking…" : "Check for details that identify you"}
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
              className="w-full bg-paper border border-edge rounded-field p-3 text-sm text-ink placeholder:text-ink-muted font-text"
            />
            <p className="text-[11px] text-ink-muted mt-1">
              Be cautious of stylometry or unique details that only you could know.
            </p>
          </div>
        </div>

        {/* AI Redaction review if available */}
        {aiError && (
          <p role="alert" className="border-l-4 border-l-bad bg-paper p-3 text-xs text-bad">{aiError}</p>
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
          <h2 className="text-sm font-semibold text-ink">Evidence</h2>
          <div className="card-inset p-4">
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
              className="btn-primary px-4 text-sm"
            >
              Choose files
            </label>
            <p className="text-xs text-ink-muted mt-2">
              PDFs, PNG or JPEG. A PDF is rasterised page by page, so anything a viewer could recover from its
              revision history is gone; an image is re-encoded without its EXIF.
            </p>
          </div>

          {selectedFiles.length > 0 && (
            <div className="space-y-2 mt-3">
              {selectedFiles.map((sf, idx) => (
                <div
                  key={idx}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 card-inset p-3 text-xs"
                >
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <span className="datum break-all text-ink">{sf.file.name}</span>
                    <span className="text-ink-muted">{(sf.file.size / 1024).toFixed(1)} KB</span>
                    <label className="min-h-[44px] flex items-center gap-2 cursor-pointer text-ink-muted hover:text-ink">
                      <input
                        type="checkbox"
                        checked={sf.scanMode}
                        onChange={() => handleToggleScanMode(idx)}
                        className="h-4 w-4 shrink-0 cursor-pointer accent-[var(--color-ask)]"
                      />
                      <span>Photocopier scan mode</span>
                    </label>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveFile(idx)}
                    aria-label={`Remove ${sf.file.name}`}
                    className="btn-secondary min-w-[72px] shrink-0 px-3 text-xs text-bad hover:bg-paper-3"
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
          <div role="status" aria-live="polite" className="card-inset border-l-4 border-l-ask p-4 text-xs text-ink-muted space-y-1">
            {progress.phase === "cleaning" && (
              <div>Stripping metadata from file {progress.current} of {progress.total}, in this browser.</div>
            )}
            {progress.phase === "reporting" && <div>Writing the report of what was removed.</div>}
            {progress.phase === "sealing" && <div>Encrypting the exhibits with XChaCha20-Poly1305.</div>}
            {progress.phase === "uploading-evidence" && <div>Uploading the ciphertext. No plaintext leaves this tab.</div>}
            {progress.phase === "sealing-keys" && (
              <div>Sealing the key to panel member {progress.current} of {progress.total}.</div>
            )}
            {progress.phase === "mining-pow" && (
              <div>Solving the {programme.pow_bits}-bit proof of work, so spam costs CPU.</div>
            )}
            {progress.phase === "signing" && <div>Signing the submission with your derived Ed25519 key.</div>}
            {progress.phase === "relaying" && <div>Handing it to the relayer queue.</div>}
          </div>
        )}

        {submitError && (
          <p role="alert" className="border-l-4 border-l-bad bg-paper p-3 text-xs text-bad">
            {submitError}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="btn-primary min-h-[48px] w-full text-sm disabled:bg-paper-2 disabled:text-ink-muted disabled:cursor-not-allowed"
        >
          {submitting ? "Cleaning, encrypting and signing…" : "Submit the tip"}
        </button>
      </form>
      </div>
    </div>
  );
}
