import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Copy, QrCode, Share2 } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type ShareLinkActionsProps = {
  getUrl: () => string;
  copyLabel?: string;
  shareTitle?: string;
  className?: string;
  popoverAlign?: "start" | "center" | "end";
};

export default function ShareLinkActions({
  getUrl,
  copyLabel = "Copy Link",
  shareTitle = "Join me",
  className,
  popoverAlign = "center",
}: ShareLinkActionsProps) {
  const [copied, setCopied] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [qrUrl, setQrUrl] = useState("");
  const copyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  const markCopied = () => {
    setCopied(true);
    if (copyTimerRef.current !== null) {
      window.clearTimeout(copyTimerRef.current);
    }
    copyTimerRef.current = window.setTimeout(() => setCopied(false), 2000);
  };

  const copyToClipboard = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      markCopied();
      toast.success("Link copied");
      return true;
    } catch {
      toast.error("Could not copy link. Please try again.");
      return false;
    }
  };

  const handlePrimaryCopy = async () => {
    const url = getUrl();
    if (!url) return;
    const copiedOk = await copyToClipboard(url);
    if (copiedOk) {
      setPopoverOpen(true);
    }
  };

  const handleNativeShare = async () => {
    const url = getUrl();
    if (!url) return;

    if (!navigator.share) {
      const copiedOk = await copyToClipboard(url);
      if (copiedOk) {
        toast.message("Native share is not available. Link copied instead.");
      }
      return;
    }

    try {
      await navigator.share({ title: shareTitle, url });
      setPopoverOpen(false);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
    }
  };

  const handleOpenQr = () => {
    const url = getUrl();
    if (!url) return;
    setQrUrl(url);
    setPopoverOpen(false);
    setQrOpen(true);
  };

  return (
    <>
      <div className={cn("inline-flex", className)}>
        <Button variant="outline" onClick={handlePrimaryCopy} className="rounded-r-none">
          {copied ? <Check className="size-4 mr-1" /> : <Copy className="size-4 mr-1" />}
          {copyLabel}
        </Button>

        <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              className="rounded-l-none border-l-0"
              aria-label="More share options"
            >
              <ChevronDown className="size-4" />
            </Button>
          </PopoverTrigger>

          <PopoverContent align={popoverAlign} className="w-56 p-2">
            <div className="space-y-1">
              <Button variant="ghost" className="w-full justify-start" onClick={handleNativeShare}>
                <Share2 className="size-4 mr-2" />
                Share
              </Button>
              <Button variant="ghost" className="w-full justify-start" onClick={handleOpenQr}>
                <QrCode className="size-4 mr-2" />
                Show QR Code
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      <Dialog open={qrOpen} onOpenChange={setQrOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Invite via QR Code</DialogTitle>
            <DialogDescription>
              Scan to open the invite link and join this group or tournament. No account needed.
            </DialogDescription>
          </DialogHeader>

          <Card className="mx-auto w-fit">
            <CardContent className="p-3">
              <QRCodeSVG value={qrUrl} size={220} includeMargin />
            </CardContent>
          </Card>
        </DialogContent>
      </Dialog>
    </>
  );
}