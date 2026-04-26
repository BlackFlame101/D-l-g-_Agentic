"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useUser } from "@/hooks/use-user";
import { agentsApi } from "@/lib/api";
import type { Agent } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Bot, Save, Plus, Sparkles, MessageSquare,
  ShoppingBag, BookOpen, BellOff, Wand2,
} from "lucide-react";
import { toast } from "sonner";

// ── Types ────────────────────────────────────────────────────────────────────

type TemplateLang = "ar" | "fr" | "en";

interface Template {
  id: string;
  icon: React.ReactNode;
  system_prompt: Record<TemplateLang, string>;
  greeting_message: Record<TemplateLang, string>;
  fallback_message: Record<TemplateLang, string>;
}

// ── Templates ────────────────────────────────────────────────────────────────

const TEMPLATES: Template[] = [
  {
    id: "auto-reply",
    icon: <MessageSquare className="h-5 w-5" />,
    system_prompt: {
      ar: "Salam a khouya labass 3lik ki dayr? Ana assistant WhatsApp dyal l-hondaya dyalek. Ghadi n3awnek n3raf chi 3lach bghiti w n7yt l-équipe bach ykml m3ak. Koun mzian w mohtaram. Ma t3tich waqt m7ddad.",
      fr: "Vous êtes un assistant WhatsApp pour une entreprise marocaine. Votre rôle est d'accueillir les clients, collecter leurs noms et demandes, et les informer que l'équipe les contactera bientôt. Soyez toujours poli et professionnel.",
      en: "You are a WhatsApp assistant for a Moroccan business. Your job is to greet customers, collect their name and request, and let them know the team will follow up shortly. Always be polite and professional. Never promise specific times.",
    },
    greeting_message: {
      ar: "Salam a khouya labass 3lik ki dayr? Merhba bik f l-hondaya dyalek. Kif nqdar n3awnek lyouma? 😊",
      fr: "Salam! Bienvenue. Comment puis-je vous aider aujourd'hui? 😊",
      en: "Hi! Welcome. How can I help you today? 😊",
    },
    fallback_message: {
      ar: "Smahli a khouya, ma fhmtch mzyan. Wach tqdr t3awd tswl?",
      fr: "Désolé, je n'ai pas bien compris. Pouvez-vous reformuler?",
      en: "Sorry, I didn't quite understand. Could you rephrase that?",
    },
  },
  {
    id: "shopify",
    icon: <ShoppingBag className="h-5 w-5" />,
    system_prompt: {
      ar: "Salam a khouya labass 3lik ki dayr? Ana assistant dyal l-boutique dyalek 3la WhatsApp. Ghadi n3awnek f l-commandes dyalek, tswl 3la l-livraison, w njawb 3la l-sw2alat dyal l-produits. Lwaqt kayswl 3la commande dyalo, kheddm l-ma3lumat li 3ndk bach tjawb b tari9a directa — ma tswlch 3la l-numéro dyal telephone 7ta kan 3ndk.",
      fr: "Vous êtes un assistant commercial WhatsApp pour une boutique en ligne. Vous aidez les clients avec leurs commandes, le suivi des livraisons, et les questions sur les produits. Quand un client demande sa commande, utilisez les infos disponibles — ne demandez jamais son numéro de téléphone.",
      en: "You are a WhatsApp sales assistant for an online store. Help customers with their orders, delivery tracking, and product questions. When a customer asks about their order, use the order info provided — never ask for their phone number as you already have it.",
    },
    greeting_message: {
      ar: "Salam a khouya labass 3lik ki dayr? Merhba bik f l-boutique dyalek 🛍️ Wash baghi tchoufi chi produit ola t9der n3awnek f commande dyalek?",
      fr: "Salam! Bienvenue dans notre boutique 🛍️ Vous souhaitez voir un produit ou suivre votre commande?",
      en: "Hi! Welcome to our store 🛍️ Looking for a product or want to track your order?",
    },
    fallback_message: {
      ar: "Smahli a khouya, had s-sw2al khasni n9lbo m3a l-équipe. Ash bghiti t3rf b-zzt?",
      fr: "Désolé, je dois vérifier ça avec l'équipe. Que souhaitez-vous savoir exactement?",
      en: "Sorry, I need to check that with the team. What exactly would you like to know?",
    },
  },
  {
    id: "knowledge",
    icon: <BookOpen className="h-5 w-5" />,
    system_prompt: {
      ar: "Salam a khouya labass 3lik ki dayr? Ana assistant khayer bach njawb 3la l-sw2alat mn l-wraq li 3ndk bas. Ma kan had jwab f l-ma3lumat li 3ndk, goul liha b sadi9 w 3red l-rabt l-client m3a wa7d mn l-équipe. Ma tkhll3ch ma3lumat.",
      fr: "Vous êtes un assistant expert qui répond aux questions uniquement à partir des documents fournis. Si la réponse n'est pas dans votre base de connaissances, dites-le honnêtement et proposez de connecter le client avec un membre de l'équipe.",
      en: "You are an expert assistant that answers questions strictly based on provided documents. If the answer is not in your knowledge base, say so honestly and offer to connect the customer with a team member. Never invent information.",
    },
    greeting_message: {
      ar: "Salam a khouya labass 3lik ki dayr? Ana l-assistant dyalek. Su2ali 3la ay haja w ghadi njawbek! 📚",
      fr: "Salam! Je suis l'assistant intelligent. Posez-moi n'importe quelle question! 📚",
      en: "Hi! I'm the smart assistant. Ask me anything and I'll help! 📚",
    },
    fallback_message: {
      ar: "Hada ma kaynch f l-ma3lumat li 3ndi. Ghadi n3awdek m3a l-équipe dyalek.",
      fr: "Cette information n'est pas dans ma base. Je vais vous connecter avec notre équipe.",
      en: "That info isn't in my knowledge base. Let me connect you with our team.",
    },
  },
  {
    id: "unavailable",
    icon: <BellOff className="h-5 w-5" />,
    system_prompt: {
      ar: "Salam a khouya labass 3lik ki dayr? Ana assistant mo2aqqat. L-hondaya/ma7alla ma kaynach mawjoud daba. R7yb l-clients, 3lmmhom b annahom ma kaynch, jmi3 l-ism dyalhom w l-talab dyalhom, w akid lhom annahom l-équipe ghadi ytwsal m3hom daba. Ma t3tich chi ma3lumat ukhra.",
      fr: "Vous êtes un assistant temporaire. Le magasin/l'entreprise n'est pas disponible actuellement. Accueillez les clients, informez-les de l'indisponibilité, collectez leur nom et demande, et confirmez que l'équipe les contactera bientôt.",
      en: "You are a temporary assistant. The store/business is currently unavailable. Greet customers, inform them of unavailability, collect their name and request, and confirm the team will reach out soon. Do not provide any other information.",
    },
    greeting_message: {
      ar: "Salam a khouya labass 3lik ki dayr? Chokran 3la l-twsal dyalek. Daba khraj mn w9t l-khidma. Khlli njiw b l-ma3lumat dyalek w ntwsal m3ak daba 🙏",
      fr: "Salam! Merci de nous contacter. Nous sommes actuellement hors des heures de travail. Laissez-nous vos infos et nous vous contacterons bientôt 🙏",
      en: "Hi! Thanks for reaching out. We're currently outside business hours. Leave us your details and we'll get back to you soon 🙏",
    },
    fallback_message: {
      ar: "Chokran 3la l-rsal dyalek. L-équipe ghadi ytwsal m3ak daba.",
      fr: "Merci pour votre message. L'équipe vous contactera bientôt.",
      en: "Thanks for your message. The team will be in touch soon.",
    },
  },
];

// ── Constants ─────────────────────────────────────────────────────────────────

const LANGUAGES = [
  { value: "ar", label: "العربية" },
  { value: "fr", label: "Français" },
  { value: "en", label: "English" },
  { value: "darija", label: "الدارجة" },
];

const TONES = [
  { value: "professional", label: "Professional" },
  { value: "friendly", label: "Friendly" },
  { value: "concierge", label: "Prestige Concierge" },
  { value: "casual", label: "Casual" },
];

const TEMPLATE_LANGS: { value: TemplateLang; label: string }[] = [
  { value: "ar", label: "عربي / دارجة" },
  { value: "fr", label: "Français" },
  { value: "en", label: "English" },
];

const TEMPLATE_LABELS: Record<string, string> = {
  "auto-reply": "Auto-Reply",
  "shopify": "Shopify Store",
  "knowledge": "Knowledge Base",
  "unavailable": "Not Available",
};

const TEMPLATE_DESCS: Record<string, string> = {
  "auto-reply": "Handle all messages, collect requests, escalate to human.",
  "shopify": "Orders, tracking, product questions, payment status.",
  "knowledge": "Answer questions strictly from your uploaded documents.",
  "unavailable": "Inform customers you're unavailable and take a message.",
};

// ── Page ─────────────────────────────────────────────────────────────────────

export default function AgentPage() {
  const t = useTranslations("Dashboard");
  const { user } = useUser();

  const [agent, setAgent] = useState<Agent | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Agent fields
  const [name, setName] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [language, setLanguage] = useState("fr");
  const [tone, setTone] = useState("professional");
  const [greeting, setGreeting] = useState("");
  const [fallback, setFallback] = useState("");
  const [isActive, setIsActive] = useState(true);

  // Quick setup
  const [templateLang, setTemplateLang] = useState<TemplateLang>("fr");
  const [generateDesc, setGenerateDesc] = useState("");
  const [generateLang, setGenerateLang] = useState<TemplateLang>("fr");
  const [generating, setGenerating] = useState(false);
  const [activeTemplate, setActiveTemplate] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    loadAgent();
  }, [user]);

  async function loadAgent() {
    setLoading(true);
    try {
      const agents = await agentsApi.list();
      if (agents.length > 0) {
        const a = agents[0];
        setAgent(a);
        setName(a.name);
        setSystemPrompt(a.system_prompt || "");
        setLanguage(a.language || "fr");
        setTone(a.tone || "professional");
        setGreeting(a.greeting_message || "");
        setFallback(a.fallback_message || "");
        setIsActive(a.is_active);
      }
    } catch {
      toast.error(t("errors.loadAgent"));
    } finally {
      setLoading(false);
    }
  }

  function applyTemplate(template: Template) {
    setSystemPrompt(template.system_prompt[templateLang]);
    setGreeting(template.greeting_message[templateLang]);
    setFallback(template.fallback_message[templateLang]);
    setActiveTemplate(template.id);
    toast.success("Template applied! You can edit the fields below.");
  }

  async function handleGenerate() {
    if (!generateDesc.trim()) {
      toast.error("Please describe what you want your agent to do.");
      return;
    }
    setGenerating(true);
    try {
      const result = await agentsApi.generatePrompt({
        description: generateDesc,
        language: generateLang,
      });
      setSystemPrompt(result.system_prompt);
      setGreeting(result.greeting_message);
      setFallback(result.fallback_message);
      setActiveTemplate(null);
      toast.success("Prompt generated! Review and save.");
    } catch (err: any) {
      toast.error(err.message || "Failed to generate prompt.");
    } finally {
      setGenerating(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      if (agent) {
        const updated = await agentsApi.update(agent.id, {
          name, system_prompt: systemPrompt, language,
          tone, greeting_message: greeting,
          fallback_message: fallback, is_active: isActive,
        });
        setAgent(updated);
        toast.success(t("agent.saved"));
      } else {
        const created = await agentsApi.create({
          name, system_prompt: systemPrompt, language,
          tone, greeting_message: greeting,
          fallback_message: fallback, is_active: isActive,
        });
        setAgent(created);
        toast.success(t("agent.created"));
      }
    } catch (err: any) {
      toast.error(err.message || t("errors.saveAgent"));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Card><CardContent className="space-y-4 pt-6">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </CardContent></Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-xl font-bold text-foreground">
            {agent ? t("agent.configTitle") : t("agent.createTitle")}
          </h1>
          <p className="text-sm text-muted-foreground">{t("agent.configDesc")}</p>
        </div>
        <Button onClick={handleSave} disabled={saving || !name} className="gap-2">
          {agent ? <Save className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {saving ? t("saving") : agent ? t("agent.saveChanges") : t("agent.createAgent")}
        </Button>
      </div>

      {/* ── Quick Setup ── */}
      <Card className="border-secondary/30 bg-secondary/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-secondary" />
            {t("agent.quickSetup")}
          </CardTitle>
          <p className="text-xs text-muted-foreground">{t("agent.quickSetupDesc")}</p>
        </CardHeader>
        <CardContent className="space-y-5">

          {/* Template cards */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{t("agent.templateLang")}</span>
              <div className="flex gap-1">
                {TEMPLATE_LANGS.map((l) => (
                  <Button
                    key={l.value}
                    size="sm"
                    variant={templateLang === l.value ? "default" : "outline"}
                    className="h-7 px-2 text-xs"
                    onClick={() => setTemplateLang(l.value)}
                  >
                    {l.label}
                  </Button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {TEMPLATES.map((template) => (
                <button
                  key={template.id}
                  onClick={() => applyTemplate(template)}
                  className={`
                    flex flex-col items-start gap-2 rounded-lg border p-3 text-left
                    transition-all hover:border-secondary hover:bg-secondary/10
                    ${activeTemplate === template.id
                      ? "border-secondary bg-secondary/10"
                      : "border-border bg-background"
                    }
                  `}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-secondary">{template.icon}</span>
                    {activeTemplate === template.id && (
                      <Badge className="h-4 bg-secondary/20 px-1 text-[10px] text-secondary">
                        Active
                      </Badge>
                    )}
                  </div>
                  <span className="text-xs font-semibold text-foreground">
                    {TEMPLATE_LABELS[template.id]}
                  </span>
                  <span className="text-[11px] leading-tight text-muted-foreground">
                    {TEMPLATE_DESCS[template.id]}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Divider */}
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">or generate with AI</span>
            </div>
          </div>

          {/* AI Generator */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{t("agent.generateTitle")}</span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{t("agent.generateLang")}</span>
                <div className="flex gap-1">
                  {TEMPLATE_LANGS.map((l) => (
                    <Button
                      key={l.value}
                      size="sm"
                      variant={generateLang === l.value ? "default" : "outline"}
                      className="h-7 px-2 text-xs"
                      onClick={() => setGenerateLang(l.value)}
                    >
                      {l.label}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <Textarea
                value={generateDesc}
                onChange={(e) => setGenerateDesc(e.target.value)}
                placeholder={t("agent.generatePlaceholder")}
                rows={2}
                className="resize-none text-sm"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleGenerate();
                }}
              />
            </div>
            <Button
              onClick={handleGenerate}
              disabled={generating || !generateDesc.trim()}
              className="gap-2 w-full sm:w-auto"
              variant="outline"
            >
              {generating
                ? <><span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> {t("agent.generating")}</>
                : <><Wand2 className="h-4 w-4" /> {t("agent.generateBtn")}</>
              }
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── General Settings ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-secondary" />
            {t("agent.generalSection")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="agentName">{t("agent.name")}</Label>
              <Input
                id="agentName"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("agent.namePlaceholder")}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("agent.language")}</Label>
              <Select value={language} onValueChange={(v) => v && setLanguage(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {LANGUAGES.map((l) => (
                    <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>{t("agent.tone")}</Label>
              <Select value={tone} onValueChange={(v) => v && setTone(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TONES.map((to) => (
                    <SelectItem key={to.value} value={to.value}>{to.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end gap-3 pb-1">
              <div className="space-y-2">
                <Label>{t("agent.active")}</Label>
                <div className="flex items-center gap-2">
                  <Switch checked={isActive} onCheckedChange={setIsActive} />
                  <span className="text-sm text-muted-foreground">
                    {isActive ? t("operational") : t("inactive")}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── System Prompt ── */}
      <Card>
        <CardHeader>
          <CardTitle>{t("agent.systemPromptSection")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="systemPrompt">{t("agent.systemPrompt")}</Label>
            <Textarea
              id="systemPrompt"
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder={t("agent.systemPromptPlaceholder")}
              rows={8}
              className="resize-y font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">{systemPrompt.length}/8000</p>
          </div>
        </CardContent>
      </Card>

      {/* ── Messages ── */}
      <Card>
        <CardHeader>
          <CardTitle>{t("agent.messagesSection")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="greeting">{t("agent.greeting")}</Label>
            <Textarea
              id="greeting"
              value={greeting}
              onChange={(e) => setGreeting(e.target.value)}
              placeholder={t("agent.greetingPlaceholder")}
              rows={3}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="fallback">{t("agent.fallback")}</Label>
            <Textarea
              id="fallback"
              value={fallback}
              onChange={(e) => setFallback(e.target.value)}
              placeholder={t("agent.fallbackPlaceholder")}
              rows={3}
            />
          </div>
        </CardContent>
      </Card>

    </div>
  );
}
