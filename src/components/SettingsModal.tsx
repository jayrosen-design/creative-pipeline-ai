import { useState, useEffect } from "react";
import { Settings, Eye, EyeOff, Save, HardDrive, Server, FolderOpen, FolderX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  chooseLocalSaveDirectory,
  clearStoredLocalSaveDirectory,
  hasStoredLocalSaveDirectory,
  supportsLocalFolderSave,
} from "@/lib/localSave";

const KEYS_STORAGE = "brandforge_api_keys";

export type StorageProvider = "local" | "aws";

export interface ApiKeys {
  flux_api_key: string;
  flux_base_url: string;
  openai_api_key: string;
  gemini_api_key: string;
  google_translate_key: string;
  storage_provider: StorageProvider;
  aws_access_key_id: string;
  aws_secret_access_key: string;
  aws_region: string;
  aws_s3_bucket: string;
}

const DEFAULTS: ApiKeys = {
  flux_api_key: "",
  flux_base_url: "",
  openai_api_key: "",
  gemini_api_key: "",
  google_translate_key: "",
  storage_provider: "local",
  aws_access_key_id: "",
  aws_secret_access_key: "",
  aws_region: "us-east-1",
  aws_s3_bucket: "",
};

const loadKeys = (): ApiKeys => {
  try {
    const raw = localStorage.getItem(KEYS_STORAGE);
    if (!raw) return { ...DEFAULTS };

    const parsed = JSON.parse(raw);
    return {
      ...DEFAULTS,
      ...parsed,
      flux_api_key: parsed.flux_api_key || parsed.image_gen_api_key || "",
      flux_base_url: parsed.flux_base_url || parsed.image_gen_base_url || DEFAULTS.flux_base_url,
      gemini_api_key: parsed.gemini_api_key || parsed.nano_banana_api_key || "",
      storage_provider: parsed.storage_provider === "aws" ? "aws" : "local",
    };
  } catch {
    return { ...DEFAULTS };
  }
};

export const getStoredKeys = loadKeys;

const SettingsModal = () => {
  const [open, setOpen] = useState(false);
  const [keys, setKeys] = useState<ApiKeys>(loadKeys);
  const [showField, setShowField] = useState<Record<string, boolean>>({});
  const [hasLocalFolder, setHasLocalFolder] = useState(false);

  useEffect(() => {
    if (!open) return;

    setKeys(loadKeys());
    hasStoredLocalSaveDirectory().then(setHasLocalFolder).catch(() => setHasLocalFolder(false));
  }, [open]);

  const toggle = (field: string) => setShowField((p) => ({ ...p, [field]: !p[field] }));

  const handleSave = () => {
    if (keys.storage_provider === "aws") {
      if (!keys.aws_access_key_id || !keys.aws_secret_access_key || !keys.aws_s3_bucket) {
        toast.error("AWS requires Access Key, Secret Key, and Bucket name");
        return;
      }
    }
    localStorage.setItem(KEYS_STORAGE, JSON.stringify(keys));
    toast.success("Settings saved");
    setOpen(false);
  };

  const handleChooseFolder = async () => {
    try {
      const folderName = await chooseLocalSaveDirectory();
      setHasLocalFolder(true);
      toast.success(`Local save folder selected: ${folderName}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not select local save folder";
      toast.error(message);
    }
  };

  const handleClearFolder = async () => {
    try {
      await clearStoredLocalSaveDirectory();
      setHasLocalFolder(false);
      toast.success("Local save folder cleared");
    } catch {
      toast.error("Could not clear local save folder");
    }
  };

  const apiFields: { key: keyof ApiKeys; label: string; placeholder: string; hint: string }[] = [
    {
      key: "flux_api_key",
      label: "Image Generation API Key (Flux.1 Dev)",
      placeholder: "your-bfl-key",
      hint: "API key for your LiteLLM proxy or compatible image generation endpoint.",
    },
    {
      key: "flux_base_url",
      label: "Image Generation Base URL",
      placeholder: "https://your-litellm-proxy.com",
      hint: "Base URL of the OpenAI-compatible image generation API used for Flux.",
    },
    {
      key: "openai_api_key",
      label: "OpenAI API Key (GPT-Image)",
      placeholder: "sk-...",
      hint: "Used when the selected image model is GPT-Image.",
    },
    {
      key: "gemini_api_key",
      label: "Gemini API Key (Nano Banana 2)",
      placeholder: "AIza...",
      hint: "Used when the selected image model is Nano Banana 2 via Google Gemini.",
    },
    {
      key: "google_translate_key",
      label: "Google Translate API Key",
      placeholder: "AIza...",
      hint: "If provided, uses Google Translate API; otherwise falls back to AI translation",
    },
  ];

  const awsFields: { key: keyof ApiKeys; label: string; placeholder: string; hint: string; secret?: boolean }[] = [
    {
      key: "aws_access_key_id",
      label: "AWS Access Key ID",
      placeholder: "AKIA...",
      hint: "Your IAM user access key with S3 permissions",
      secret: true,
    },
    {
      key: "aws_secret_access_key",
      label: "AWS Secret Access Key",
      placeholder: "wJalr...",
      hint: "The secret key paired with your access key ID",
      secret: true,
    },
    {
      key: "aws_region",
      label: "AWS Region",
      placeholder: "us-east-1",
      hint: "The AWS region where your S3 bucket is located",
    },
    {
      key: "aws_s3_bucket",
      label: "S3 Bucket Name",
      placeholder: "my-campaign-assets",
      hint: "The S3 bucket for storing generated images and videos",
    },
  ];

  const isSecretField = (key: string) =>
    key === "flux_api_key" ||
    key === "openai_api_key" ||
    key === "gemini_api_key" ||
    key === "google_translate_key" ||
    key === "aws_access_key_id" ||
    key === "aws_secret_access_key";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs">
          <Settings className="h-3.5 w-3.5 mr-1" /> Settings
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Configure provider keys, local folder saving, and where generated media should be stored.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          {/* API Keys Section */}
          <h3 className="text-sm font-semibold text-foreground">API Keys</h3>
          {apiFields.map(({ key, label, placeholder, hint }) => (
            <div key={key} className="space-y-2">
              <Label htmlFor={key}>{label}</Label>
              <div className="relative">
                <Input
                  id={key}
                  type={isSecretField(key) && !showField[key] ? "password" : "text"}
                  value={keys[key] as string}
                  onChange={(e) => setKeys({ ...keys, [key]: e.target.value })}
                  placeholder={placeholder}
                  className="pr-10"
                />
                {isSecretField(key) && (
                  <button
                    type="button"
                    onClick={() => toggle(key)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showField[key] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground">{hint}</p>
            </div>
          ))}

          <Separator />

          <h3 className="text-sm font-semibold text-foreground">Local Save Folder</h3>
          <div className="space-y-2 rounded-md border border-border p-3 bg-muted/30">
            <p className="text-[10px] text-muted-foreground">
              {supportsLocalFolderSave()
                ? hasLocalFolder
                  ? "Saved images will also be written into brand/campaign/product folders on this machine."
                  : "Pick a local folder so Save can also write files into brand/campaign/product folders."
                : "This browser will fall back to normal downloads because folder-based local saving is not supported."}
            </p>
            {supportsLocalFolderSave() && (
              <div className="flex gap-2">
                <Button type="button" variant="outline" className="flex-1" onClick={handleChooseFolder}>
                  <FolderOpen className="h-4 w-4 mr-2" /> {hasLocalFolder ? "Change Folder" : "Choose Folder"}
                </Button>
                {hasLocalFolder && (
                  <Button type="button" variant="ghost" onClick={handleClearFolder}>
                    <FolderX className="h-4 w-4 mr-2" /> Clear
                  </Button>
                )}
              </div>
            )}
          </div>

          <Separator />

          {/* Storage Provider Section */}
          <h3 className="text-sm font-semibold text-foreground">Storage Provider</h3>
          <div className="space-y-2">
            <Label>Where should generated media be stored?</Label>
            <Select
              value={keys.storage_provider}
              onValueChange={(v) => setKeys({ ...keys, storage_provider: v as StorageProvider })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="local">
                  <span className="flex items-center gap-2">
                    <HardDrive className="h-3.5 w-3.5" /> Local App Storage
                  </span>
                </SelectItem>
                <SelectItem value="aws">
                  <span className="flex items-center gap-2">
                    <Server className="h-3.5 w-3.5" /> AWS S3
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground">
              {keys.storage_provider === "local"
                ? "Store generated media locally through this app."
                : "Store media in your own AWS S3 bucket. Provide credentials below."}
            </p>
          </div>

          {keys.storage_provider === "aws" && (
            <div className="space-y-4 rounded-md border border-border p-3 bg-muted/30">
              {awsFields.map(({ key, label, placeholder, hint, secret }) => (
                <div key={key} className="space-y-2">
                  <Label htmlFor={key}>{label}</Label>
                  <div className="relative">
                    <Input
                      id={key}
                      type={secret && !showField[key] ? "password" : "text"}
                      value={keys[key] as string}
                      onChange={(e) => setKeys({ ...keys, [key]: e.target.value })}
                      placeholder={placeholder}
                      className="pr-10"
                    />
                    {secret && (
                      <button
                        type="button"
                        onClick={() => toggle(key)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showField[key] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    )}
                  </div>
                  <p className="text-[10px] text-muted-foreground">{hint}</p>
                </div>
              ))}
            </div>
          )}

          <Button onClick={handleSave} className="w-full">
            <Save className="h-4 w-4 mr-2" /> Save Settings
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default SettingsModal;
