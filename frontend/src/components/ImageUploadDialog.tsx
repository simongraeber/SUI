import {
  useRef,
  useState,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

/* ── Helpers ─────────────────────────────────────────────────── */

async function resizeImage(
  file: File,
  maxDim = 1024,
  quality = 0.8,
): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality });
  return new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), {
    type: "image/jpeg",
  });
}

/* ── Public API ──────────────────────────────────────────────── */

export interface ImageUploadDialogProps {
  /** "profile" = square avatar preview, "team" = landscape 16:9 preview */
  variant: "profile" | "team";
  /** Display name (user name or team name) – used for fallback initial */
  name: string;
  /** Save the raw uploaded file directly. */
  onSaveOriginal: (file: File) => Promise<void>;
  /** AI generation. If provided the "AI Enhance" button appears. */
  onGenerate?: (file: File) => Promise<{ blob: Blob; imageId: string }>;
  /** Save the AI-generated image. Required when onGenerate is provided. */
  onSaveAI?: (imageId: string) => Promise<void>;
}

export interface ImageUploadDialogHandle {
  /** Open the native file picker */
  pickFile: () => void;
  /** Open dialog in generating state with an external promise (e.g. Sparkles) */
  startExternalGeneration: (
    promise: Promise<{ blob: Blob; imageId: string }>,
  ) => void;
}

/* ── Dialog states ───────────────────────────────────────────── */
type DialogPhase = "preview" | "generating" | "ai-done" | "error";

/* ── Component ───────────────────────────────────────────────── */

const ImageUploadDialog = forwardRef<
  ImageUploadDialogHandle,
  ImageUploadDialogProps
>(function ImageUploadDialog(
  { variant, name, onSaveOriginal, onGenerate, onSaveAI },
  ref,
) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cancelledRef = useRef(false);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [phase, setPhase] = useState<DialogPhase>("preview");
  const [originalFile, setOriginalFile] = useState<File | null>(null);
  const [originalPreview, setOriginalPreview] = useState<string | null>(null);
  const [aiPreview, setAiPreview] = useState<string | null>(null);
  const [aiImageId, setAiImageId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSquare = variant === "profile";
  const subjectLabel = isSquare ? "Profile Picture" : "Team Picture";

  /* ── helpers ── */

  const reset = useCallback(() => {
    cancelledRef.current = true;
    setDialogOpen(false);
    setPhase("preview");
    setOriginalFile(null);
    setOriginalPreview(null);
    setAiPreview(null);
    setAiImageId(null);
    setSaving(false);
    setError(null);
  }, []);

  const runGeneration = useCallback(
    async (file: File) => {
      if (!onGenerate) return;
      cancelledRef.current = false;
      setPhase("generating");
      setError(null);
      try {
        const { blob, imageId } = await onGenerate(file);
        if (cancelledRef.current) return;
        setAiPreview(URL.createObjectURL(blob));
        setAiImageId(imageId);
        setPhase("ai-done");
      } catch (err) {
        if (!cancelledRef.current) {
          setError(
            err instanceof Error ? err.message : "AI generation failed",
          );
          setPhase("error");
        }
      }
    },
    [onGenerate],
  );

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      e.target.value = "";
      let finalFile: File;
      try {
        finalFile = await resizeImage(file);
      } catch {
        finalFile = file;
      }
      setOriginalFile(finalFile);
      setOriginalPreview(URL.createObjectURL(finalFile));
      setAiPreview(null);
      setAiImageId(null);
      setError(null);
      setPhase("preview");
      setDialogOpen(true);
    },
    [],
  );

  /* ── imperative handle ── */

  useImperativeHandle(
    ref,
    () => ({
      pickFile: () => fileInputRef.current?.click(),
      startExternalGeneration: async (promise) => {
        cancelledRef.current = false;
        setOriginalFile(null);
        setOriginalPreview(null);
        setAiPreview(null);
        setAiImageId(null);
        setError(null);
        setPhase("generating");
        setDialogOpen(true);
        try {
          const { blob, imageId } = await promise;
          if (cancelledRef.current) return;
          setAiPreview(URL.createObjectURL(blob));
          setAiImageId(imageId);
          setPhase("ai-done");
        } catch (err) {
          if (!cancelledRef.current) {
            setError(
              err instanceof Error ? err.message : "AI generation failed",
            );
            setPhase("error");
          }
        }
      },
    }),
    [],
  );

  /* ── save handlers ── */

  const handleSaveOriginal = async () => {
    if (!originalFile) return;
    setSaving(true);
    setError(null);
    try {
      await onSaveOriginal(originalFile);
      reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save image");
      setSaving(false);
    }
  };

  const handleSaveAI = async () => {
    if (!aiImageId || !onSaveAI) return;
    setSaving(true);
    setError(null);
    try {
      await onSaveAI(aiImageId);
      reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save image");
      setSaving(false);
    }
  };

  const initial = name?.charAt(0)?.toUpperCase() ?? "?";

  /* ── which image to display ── */
  const displaySrc =
    phase === "ai-done" ? aiPreview : (originalPreview ?? aiPreview);

  /* ── description text ── */
  const description = (() => {
    switch (phase) {
      case "preview":
        return `Save this as your ${subjectLabel.toLowerCase()}, or enhance it with AI.`;
      case "generating":
        return `Creating your AI ${subjectLabel.toLowerCase()}…`;
      case "ai-done":
        return `Your AI ${subjectLabel.toLowerCase()} is ready!`;
      case "error":
        return `Something went wrong.`;
    }
  })();

  /* ── preview area ── */
  const previewContent = isSquare ? (
    <div className="relative mx-auto w-44 h-44 flex items-center justify-center">
      <div
        className="absolute inset-0 ai-shimmer-track ai-shimmer-glow pointer-events-none transition-opacity duration-700"
        style={
          {
            "--shimmer-radius": "50%",
            opacity: phase === "generating" ? 0.6 : 0,
          } as React.CSSProperties
        }
      >
        <div className="ai-shimmer ai-shimmer-spin" />
      </div>
      <Avatar className="h-40 w-40 border-2 border-muted relative z-10">
        <AvatarImage src={displaySrc ?? undefined} alt="Preview" />
        <AvatarFallback className="text-3xl">{initial}</AvatarFallback>
      </Avatar>
    </div>
  ) : (
    <div className="relative mx-auto w-full max-w-xs">
      <div
        className="absolute -inset-1 ai-shimmer-track ai-shimmer-glow pointer-events-none transition-opacity duration-700 rounded-xl"
        style={
          {
            "--shimmer-radius": "0.75rem",
            opacity: phase === "generating" ? 0.6 : 0,
          } as React.CSSProperties
        }
      >
        <div className="ai-shimmer ai-shimmer-spin" />
      </div>
      <div
        className="relative z-10 rounded-lg overflow-hidden bg-muted"
        style={{ aspectRatio: "16/9" }}
      >
        {displaySrc ? (
          <img
            src={displaySrc}
            alt="Preview"
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-2xl font-bold text-muted-foreground">
            {initial}
          </div>
        )}
      </div>
    </div>
  );

  /* ── footer buttons per phase ── */
  const footerButtons = (() => {
    switch (phase) {
      case "preview":
        return (
          <>
            <Button
              onClick={handleSaveOriginal}
              disabled={saving}
              className="flex-1 min-w-[5rem] gap-2 bg-gradient-to-br from-[var(--cta-bg-from)] to-[var(--cta-bg-to)] text-white shadow-lg shadow-primary/30 hover:shadow-primary/45"
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : "Save"}
            </Button>
            {onGenerate && (
              <Button
                variant="outline"
                className="flex-1 min-w-[5rem] gap-2"
                onClick={() => originalFile && runGeneration(originalFile)}
                disabled={saving || !originalFile}
              >
                <Sparkles className="size-4" />
                AI Enhance
              </Button>
            )}
            <Button variant="outline" className="min-w-[5rem]" onClick={reset} disabled={saving}>
              Cancel
            </Button>
          </>
        );

      case "generating":
        return (
          <Button variant="outline" className="flex-1" onClick={reset}>
            Cancel
          </Button>
        );

      case "ai-done":
        return (
          <>
            <Button
              onClick={handleSaveAI}
              disabled={saving}
              className="flex-1 min-w-[5rem] gap-2 bg-gradient-to-br from-[var(--cta-bg-from)] to-[var(--cta-bg-to)] text-white shadow-lg shadow-primary/30 hover:shadow-primary/45"
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : "Save"}
            </Button>
            {originalFile ? (
              <Button
                variant="outline"
                className="flex-1 min-w-[5rem]"
                onClick={() => {
                  setAiPreview(null);
                  setAiImageId(null);
                  setPhase("preview");
                }}
                disabled={saving}
              >
                Back
              </Button>
            ) : (
              <Button
                variant="outline"
                className="flex-1 min-w-[5rem]"
                onClick={reset}
                disabled={saving}
              >
                Discard
              </Button>
            )}
          </>
        );

      case "error":
        return (
          <>
            {onGenerate && originalFile && (
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => originalFile && runGeneration(originalFile)}
              >
                Try again
              </Button>
            )}
            {originalFile && (
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setError(null);
                  setPhase("preview");
                }}
              >
                Use original
              </Button>
            )}
            <Button variant="outline" className="flex-1" onClick={reset}>
              Cancel
            </Button>
          </>
        );
    }
  })();

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={handleFileSelect}
      />

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!open) reset();
        }}
      >
        <DialogContent className="max-w-sm text-center">

          <DialogHeader className="items-center">
            <DialogTitle>{subjectLabel}</DialogTitle>
            <DialogDescription className="whitespace-pre-line text-center min-h-[2.5rem] flex items-center justify-center">{description}</DialogDescription>
          </DialogHeader>

          {previewContent}

          {error && <p className="text-sm text-red-500">{error}</p>}

          <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:gap-3 sm:justify-center min-h-[2.75rem]">
            {footerButtons}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
});

export default ImageUploadDialog;
