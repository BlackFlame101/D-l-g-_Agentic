"use client";

import { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { useUser } from "@/hooks/use-user";
import { agentsApi, knowledgeApi } from "@/lib/api";
import type { Agent, KnowledgeBase } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  BookOpen,
  Upload,
  Trash2,
  FileText,
  File,
  AlertCircle,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";

const ACCEPTED_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
];
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

export default function KnowledgePage() {
  const t = useTranslations("Dashboard");
  const { user } = useUser();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [files, setFiles] = useState<KnowledgeBase[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    if (!user) return;
    loadData();
  }, [user]);

  async function loadData() {
    setLoading(true);
    try {
      const agents = await agentsApi.list();
      if (agents.length > 0) {
        setAgent(agents[0]);
        const kbs = await knowledgeApi.list(agents[0].id);
        setFiles(kbs);
      }
    } catch {
      toast.error(t("errors.loadKnowledge"));
    } finally {
      setLoading(false);
    }
  }

  const handleUpload = useCallback(
    async (fileList: FileList | null) => {
      if (!fileList || !agent || !user) return;

      const file = fileList[0];
      if (!file) return;

      if (file.size > MAX_FILE_SIZE) {
        toast.error(t("knowledge.fileTooLarge"));
        return;
      }

      const ext = file.name.split(".").pop()?.toLowerCase() || "";
      if (!["pdf", "docx", "txt", "md"].includes(ext)) {
        toast.error(t("knowledge.unsupportedType"));
        return;
      }

      setUploading(true);
      try {
        const supabase = createClient();
        const storagePath = `${user.id}/${agent.id}/${Date.now()}_${file.name}`;

        const { error: uploadError } = await supabase.storage
          .from("knowledge-files")
          .upload(storagePath, file);

        if (uploadError) throw uploadError;

        const kb = await knowledgeApi.upload(agent.id, {
          storage_path: storagePath,
          file_name: file.name,
          file_type: ext,
          file_size_bytes: file.size,
        });

        setFiles((prev) => [kb, ...prev]);
        toast.success(t("knowledge.uploadSuccess"));
      } catch (err: any) {
        toast.error(err.message || t("errors.uploadFailed"));
      } finally {
        setUploading(false);
      }
    },
    [agent, user, t]
  );

  async function handleDelete(kbId: string) {
    if (!agent) return;
    setDeleting(kbId);
    try {
      await knowledgeApi.delete(agent.id, kbId);
      setFiles((prev) => prev.filter((f) => f.id !== kbId));
      toast.success(t("knowledge.deleteSuccess"));
    } catch (err: any) {
      toast.error(err.message || t("errors.deleteFailed"));
    } finally {
      setDeleting(null);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    handleUpload(e.dataTransfer.files);
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <BookOpen className="mb-4 h-12 w-12 text-muted-foreground/40" />
        <p className="text-muted-foreground">{t("knowledge.noAgent")}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="font-heading text-xl font-bold text-foreground">
          {t("knowledge.title")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("knowledge.description")}
        </p>
      </div>

      {/* Upload area */}
      <Card>
        <CardContent className="pt-6">
          <label
            htmlFor="fileInput"
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 transition-colors ${
              dragOver
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/50"
            }`}
          >
            {uploading ? (
              <Loader2 className="mb-3 h-10 w-10 animate-spin text-primary" />
            ) : (
              <Upload className="mb-3 h-10 w-10 text-muted-foreground" />
            )}
            <p className="mb-1 text-sm font-medium text-foreground">
              {uploading ? t("knowledge.uploading") : t("knowledge.dropzone")}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("knowledge.dropzoneHint")}
            </p>
            <input
              id="fileInput"
              type="file"
              accept=".pdf,.docx,.txt,.md"
              onChange={(e) => handleUpload(e.target.files)}
              className="hidden"
              disabled={uploading}
            />
          </label>
        </CardContent>
      </Card>

      {/* File list */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-secondary" />
            {t("knowledge.filesTitle")} ({files.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {files.length === 0 ? (
            <div className="flex flex-col items-center py-8 text-center text-muted-foreground">
              <File className="mb-2 h-10 w-10 opacity-40" />
              <p className="text-sm">{t("knowledge.noFiles")}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {files.map((file) => (
                <div
                  key={file.id}
                  className="flex items-center gap-3 rounded-lg border border-border p-3"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                    <FileText className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {file.file_name}
                    </p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{file.file_type.toUpperCase()}</span>
                      {file.file_size_bytes && (
                        <span>
                          {(file.file_size_bytes / 1024).toFixed(0)} KB
                        </span>
                      )}
                      <span>
                        {file.chunk_count} {t("knowledge.chunks")}
                      </span>
                    </div>
                  </div>
                  <StatusBadge status={file.status} t={t} />
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => handleDelete(file.id)}
                    disabled={deleting === file.id}
                    className="text-destructive hover:bg-destructive/10"
                  >
                    {deleting === file.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatusBadge({
  status,
  t,
}: {
  status: string;
  t: (key: string) => string;
}) {
  if (status === "ready" || status === "completed") {
    return (
      <Badge variant="default" className="gap-1 bg-chart-3/20 text-chart-3">
        <CheckCircle2 className="h-3 w-3" />
        {t("knowledge.statusReady")}
      </Badge>
    );
  }
  if (status === "processing" || status === "pending") {
    return (
      <Badge variant="default" className="gap-1 bg-chart-1/20 text-chart-1">
        <Loader2 className="h-3 w-3 animate-spin" />
        {t("knowledge.statusProcessing")}
      </Badge>
    );
  }
  return (
    <Badge variant="destructive" className="gap-1">
      <AlertCircle className="h-3 w-3" />
      {t("knowledge.statusError")}
    </Badge>
  );
}
