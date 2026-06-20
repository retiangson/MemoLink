import React, { useState, useEffect, useRef } from "react";
import { changePassword } from "../api/client";
import { getProviders, addProvider, updateProvider, deleteProvider } from "../api/settingsApi";
import type { CustomProvider } from "../api/settingsApi";
import { getEmailStatus, getEmailConnectUrl, disconnectEmail, autoProcessEmails, listEmails, deleteEmail, emailToNote, emailToReminder, updateEmailAccountSettings } from "../api/emailApi";
import type { EmailStatus, EmailRecord, AutoProcessResult } from "../api/emailApi";
import { getTeamsStatus, getTeamsConnectUrl, disconnectTeams, listTeamsChats, getTeamsMessages, sendTeamsMessage, chatToNote } from "../api/teamsApi";
import type { TeamsStatus, TeamsChat, TeamsMessage } from "../api/teamsApi";
import { listConnectors, saveGitHubConnector, getGitHubConnectUrl, deleteGitHubConnector, saveJiraConnector, getJiraConnectUrl, deleteJiraConnector, getSpotifyConnectUrl, deleteSpotifyConnector } from "../api/connectorsApi";
import type { ConnectorSummary } from "../api/connectorsApi";
import { getWhatsappStatus, startWhatsapp, stopWhatsapp, resetWhatsappSession } from "../api/whatsappApi";
import type { WhatsappStatus } from "../api/whatsappApi";
import { EmailReplyPanel } from "./EmailReplyPanel";
import { MODELS } from "../constants/models";
import type { User } from "../utils/auth";

interface SettingsModalProps {
  show: boolean;
  user: User;
  onClose: () => void;
  selectedModel: string;
  onModelChange: (id: string) => void;
  modelSelectionEnabled?: boolean;
  customApiKeysEnabled?: boolean;
  ttsEnabled?: boolean;
  emailEnabled?: boolean;
  teamsEnabled?: boolean;
  workflowEnabled?: boolean;
  onReplayTour?: () => void;
  whatsappAvailable?: boolean;
  onWhatsappConnected?: () => void;
  onWhatsappDisconnected?: () => void;
}

type Tab = "profile" | "security" | "ai" | "keys" | "tts" | "connectors" | "email" | "teams" | "whatsapp" | "workflow";

const BLANK_FORM = { name: "", key: "", model: "", base_url: "" };

export function SettingsModal({
  show,
  user,
  onClose,
  selectedModel,
  onModelChange,
  modelSelectionEnabled = true,
  customApiKeysEnabled = true,
  ttsEnabled = true,
  emailEnabled = true,
  teamsEnabled = true,
  workflowEnabled = true,
  onReplayTour,
  whatsappAvailable = false,
  onWhatsappConnected,
  onWhatsappDisconnected,
}: SettingsModalProps) {
  const [tab, setTab] = useState<Tab>("profile");

  // Security tab
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwLoading, setPwLoading] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSuccess, setPwSuccess] = useState(false);

  // Custom providers
  const [providers, setProviders] = useState<CustomProvider[]>([]);
  const [providersLoading, setProvidersLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState(BLANK_FORM);
  const [addError, setAddError] = useState<string | null>(null);
  const [addLoading, setAddLoading] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState(BLANK_FORM);
  const [editError, setEditError] = useState<string | null>(null);
  const [editLoading, setEditLoading] = useState(false);
  const [deleteLoadingId, setDeleteLoadingId] = useState<number | null>(null);

  // Workflow user preference (localStorage-backed, must be declared here with all other hooks)
  const [wfSuggestions, setWfSuggestions] = useState(
    () => localStorage.getItem("memolink_workflow_suggestions") !== "false"
  );
  function toggleWfSuggestions(val: boolean) {
    setWfSuggestions(val);
    localStorage.setItem("memolink_workflow_suggestions", String(val));
  }

  // Teams connection state
  const [teamsStatus, setTeamsStatus] = useState<TeamsStatus>({ connected: false });
  const [teamsLoading, setTeamsLoading] = useState(false);
  const [teamsChats, setTeamsChats] = useState<TeamsChat[]>([]);
  const [teamsChatsLoading, setTeamsChatsLoading] = useState(false);
  const [selectedChat, setSelectedChat] = useState<TeamsChat | null>(null);
  const [teamsMessages, setTeamsMessages] = useState<TeamsMessage[]>([]);
  const [teamsMessagesLoading, setTeamsMessagesLoading] = useState(false);
  const [teamsReply, setTeamsReply] = useState("");
  const [teamsSending, setTeamsSending] = useState(false);
  const [teamsSaveResult, setTeamsSaveResult] = useState<string | null>(null);
  const [teamsError, setTeamsError] = useState<string | null>(null);

  // WhatsApp connection state
  const [waStatus, setWaStatus] = useState<WhatsappStatus>({ connected: false, status: "disconnected", qr_image: null });
  const [waLoading, setWaLoading] = useState(false);
  const [waError, setWaError] = useState<string | null>(null);
  const waPollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Email connection state
  const [emailStatus, setEmailStatus] = useState<EmailStatus>({ connected: false, accounts: [] });
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailConnecting, setEmailConnecting] = useState(false);
  const [emailConnectError, setEmailConnectError] = useState<string | null>(null);
  const [emails, setEmails] = useState<EmailRecord[]>([]);
  const [emailsLoading, setEmailsLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [autoResult, setAutoResult] = useState<AutoProcessResult | null>(null);
  const [selectedEmail, setSelectedEmail] = useState<EmailRecord | null>(null);
  const [actionLoading, setActionLoading] = useState<"note" | "reminder" | null>(null);
  const [actionResult, setActionResult] = useState<string | null>(null);
  const [pageSizeSavingId, setPageSizeSavingId] = useState<number | null>(null);
  const [connectors, setConnectors] = useState<ConnectorSummary[]>([]);
  const [connectorsLoading, setConnectorsLoading] = useState(false);
  const [connectorsError, setConnectorsError] = useState<string | null>(null);
  const [githubConnecting, setGitHubConnecting] = useState(false);
  const [githubConnectError, setGitHubConnectError] = useState<string | null>(null);
  const [jiraConnecting, setJiraConnecting] = useState(false);
  const [jiraConnectError, setJiraConnectError] = useState<string | null>(null);
  const [spotifyConnecting, setSpotifyConnecting] = useState(false);
  const [spotifyConnectError, setSpotifyConnectError] = useState<string | null>(null);
  const [connectorSaving, setConnectorSaving] = useState<"github" | "jira" | null>(null);
  const [connectorRemoving, setConnectorRemoving] = useState<"github" | "jira" | "spotify" | null>(null);
  const [connectorResult, setConnectorResult] = useState<string | null>(null);
  const [gitHubForm, setGitHubForm] = useState({ owner: "", repo: "", base_url: "", branch: "" });
  const [jiraForm, setJiraForm] = useState({ project_key: "", issue_type: "Task" });

  useEffect(() => {
    if (show) {
      loadProviders(); loadEmailStatus(); loadTeamsStatus(); loadConnectors();
      getWhatsappStatus().then(setWaStatus).catch(() => {});
      const oauthErr = sessionStorage.getItem("email_oauth_error");
      if (oauthErr) { setEmailConnectError(oauthErr); sessionStorage.removeItem("email_oauth_error"); }
      const githubOauthErr = sessionStorage.getItem("github_oauth_error");
      if (githubOauthErr) { setGitHubConnectError(githubOauthErr); sessionStorage.removeItem("github_oauth_error"); }
      const jiraOauthErr = sessionStorage.getItem("jira_oauth_error");
      if (jiraOauthErr) { setJiraConnectError(jiraOauthErr); sessionStorage.removeItem("jira_oauth_error"); }
      const spotifyOauthErr = sessionStorage.getItem("spotify_oauth_error");
      if (spotifyOauthErr) { setSpotifyConnectError(spotifyOauthErr); sessionStorage.removeItem("spotify_oauth_error"); }
    }
  }, [show]);

  async function loadTeamsStatus() {
    try {
      const s = await getTeamsStatus();
      setTeamsStatus(s);
      if (s.connected) loadTeamsChats();
    } catch { /* silently fail */ }
  }

  async function loadTeamsChats() {
    setTeamsChatsLoading(true);
    setTeamsError(null);
    try {
      setTeamsChats(await listTeamsChats());
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      setTeamsError(detail?.message ?? "Could not load Teams chats.");
      setTeamsChats([]);
    } finally { setTeamsChatsLoading(false); }
  }

  async function handleTeamsConnect() {
    setTeamsLoading(true);
    try {
      const url = await getTeamsConnectUrl();
      window.location.href = url;
    } catch { setTeamsLoading(false); }
  }

  async function handleTeamsDisconnect() {
    setTeamsLoading(true);
    try {
      await disconnectTeams();
      setTeamsStatus({ connected: false });
      setTeamsChats([]);
      setTeamsError(null);
      setSelectedChat(null);
      setTeamsMessages([]);
      await loadConnectors();
    } catch { /* silently fail */ } finally { setTeamsLoading(false); }
  }

  async function handleOpenChat(chat: TeamsChat) {
    setSelectedChat(chat);
    setTeamsMessages([]);
    setTeamsMessagesLoading(true);
    setTeamsError(null);
    setTeamsSaveResult(null);
    try {
      setTeamsMessages(await getTeamsMessages(chat.id, 20));
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      setTeamsError(detail?.message ?? "Could not load Teams messages.");
    } finally { setTeamsMessagesLoading(false); }
  }

  async function handleSendTeamsReply() {
    if (!selectedChat || !teamsReply.trim()) return;
    setTeamsSending(true);
    try {
      await sendTeamsMessage(selectedChat.id, teamsReply.trim());
      setTeamsReply("");
      setTeamsMessages(await getTeamsMessages(selectedChat.id, 20));
    } catch { /* silently fail */ } finally { setTeamsSending(false); }
  }

  async function handleChatToNote() {
    if (!selectedChat) return;
    setTeamsSaveResult(null);
    try {
      const res = await chatToNote(selectedChat.id, selectedChat.topic);
      setTeamsSaveResult(`✓ Saved as note: "${res.title}"`);
    } catch { setTeamsSaveResult("Failed to save note."); }
  }

  function stopWaPolling() {
    if (waPollingRef.current) { clearInterval(waPollingRef.current); waPollingRef.current = null; }
  }

  function startWaPolling() {
    stopWaPolling();
    let ticks = 0;
    waPollingRef.current = setInterval(async () => {
      ticks++;
      try {
        const s = await getWhatsappStatus();
        setWaStatus(s);
        if (s.connected) {
          setWaLoading(false);
          if (s.historySynced) {
            stopWaPolling();
            onWhatsappConnected?.();
          }
          // Still polling — waiting for historySynced
        } else if (s.status === "disconnected") {
          stopWaPolling();
          setWaLoading(false);
        } else if (ticks > 25) {
          stopWaPolling();
          setWaLoading(false);
          setWaError("Bridge did not respond in time. Ensure Node.js is installed and try again.");
        }
      } catch {
        stopWaPolling();
        setWaLoading(false);
        setWaError("Could not reach WhatsApp bridge. Check that Node.js is installed.");
      }
    }, 2000);
  }

  async function handleWaConnect(forceReset = false) {
    setWaLoading(true);
    setWaError(null);
    try {
      if (forceReset) {
        await resetWhatsappSession();
      }
      await startWhatsapp();
      startWaPolling();
    } catch (err: any) {
      setWaError(err?.response?.data?.detail ?? "Failed to start WhatsApp bridge. Ensure Node.js is installed.");
      setWaLoading(false);
    }
  }

  async function handleWaDisconnect() {
    stopWaPolling();
    setWaLoading(true);
    try {
      await stopWhatsapp();
      setWaStatus({ connected: false, status: "disconnected", qr_image: null });
      onWhatsappDisconnected?.();
    } catch { } finally { setWaLoading(false); }
  }

  async function loadEmailStatus() {
    try {
      const status = await getEmailStatus();
      setEmailStatus(status);
      if (status.connected) runAutoProcess();
    } catch { /* silently fail */ }
  }

  async function loadConnectors() {
    setConnectorsLoading(true);
    setConnectorsError(null);
    try {
      const rows = await listConnectors();
      setConnectors(rows);
      const github = rows.find((item) => item.id === "github");
      const jira = rows.find((item) => item.id === "jira");
      if (github?.config && typeof github.config === "object") {
        const defaultRepo = String((github.config as any).default_repo ?? "");
        const [defaultOwner, defaultRepoName] = defaultRepo.includes("/") ? defaultRepo.split("/", 2) : ["", ""];
        setGitHubForm((prev) => ({
          ...prev,
          owner: defaultOwner || prev.owner || "",
          repo: defaultRepoName || prev.repo || "",
          base_url: String((github.config as any).base_url ?? prev.base_url ?? ""),
          branch: String((github.config as any).default_branch ?? prev.branch ?? ""),
        }));
      }
      if (jira?.config && typeof jira.config === "object") {
        setJiraForm((prev) => ({
          ...prev,
          project_key: String((jira.config as any).default_project_key ?? prev.project_key ?? ""),
          issue_type: String((jira.config as any).default_issue_type ?? prev.issue_type ?? "Task"),
        }));
      }
    } catch (err: any) {
      setConnectorsError(err?.response?.data?.detail ?? "Could not load connectors.");
    } finally {
      setConnectorsLoading(false);
    }
  }

  async function handleConnectGitHub() {
    setGitHubConnecting(true);
    setGitHubConnectError(null);
    setConnectorResult(null);
    try {
      const url = await getGitHubConnectUrl();
      window.location.href = url;
    } catch (err: any) {
      setGitHubConnecting(false);
      const detail = err?.response?.data?.detail ?? "Could not start GitHub connection. Check server configuration.";
      setGitHubConnectError(detail);
    }
  }

  async function handleSaveGitHubConnector() {
    if (Boolean(gitHubForm.owner.trim()) !== Boolean(gitHubForm.repo.trim())) {
      setConnectorResult("GitHub owner and repository must be provided together.");
      return;
    }
    setConnectorSaving("github");
    setConnectorResult(null);
    try {
      await saveGitHubConnector(gitHubForm);
      setConnectorResult("✓ GitHub repository defaults saved.");
      await loadConnectors();
    } catch (err: any) {
      setConnectorResult(err?.response?.data?.detail ?? "Failed to save GitHub repository defaults.");
    } finally {
      setConnectorSaving(null);
    }
  }

  async function handleDeleteGitHubConnector() {
    setConnectorRemoving("github");
    setConnectorResult(null);
    setGitHubConnectError(null);
    try {
      await deleteGitHubConnector();
      setConnectorResult("✓ GitHub disconnected.");
      setGitHubForm({ owner: "", repo: "", base_url: "", branch: "" });
      await loadConnectors();
    } catch (err: any) {
      setConnectorResult(err?.response?.data?.detail ?? "Failed to disconnect GitHub.");
    } finally {
      setConnectorRemoving(null);
    }
  }

  async function handleSaveJiraConnector() {
    setConnectorSaving("jira");
    setConnectorResult(null);
    try {
      await saveJiraConnector(jiraForm);
      setConnectorResult("✓ Jira project defaults saved.");
      await loadConnectors();
    } catch (err: any) {
      setConnectorResult(err?.response?.data?.detail ?? "Failed to save Jira project defaults.");
    } finally {
      setConnectorSaving(null);
    }
  }

  async function handleConnectJira() {
    setJiraConnecting(true);
    setJiraConnectError(null);
    setConnectorResult(null);
    try {
      const url = await getJiraConnectUrl();
      window.location.href = url;
    } catch (err: any) {
      setJiraConnecting(false);
      const detail = err?.response?.data?.detail ?? "Could not start Jira connection. Check server configuration.";
      setJiraConnectError(detail);
    }
  }

  async function handleDeleteJiraConnector() {
    setConnectorRemoving("jira");
    setConnectorResult(null);
    setJiraConnectError(null);
    try {
      await deleteJiraConnector();
      setConnectorResult("✓ Jira disconnected.");
      setJiraForm({ project_key: "", issue_type: "Task" });
      await loadConnectors();
    } catch (err: any) {
      setConnectorResult(err?.response?.data?.detail ?? "Failed to disconnect Jira.");
    } finally {
      setConnectorRemoving(null);
    }
  }

  async function handleConnectSpotify() {
    setSpotifyConnecting(true);
    setSpotifyConnectError(null);
    setConnectorResult(null);
    try {
      const url = await getSpotifyConnectUrl();
      window.location.href = url;
    } catch (err: any) {
      setSpotifyConnecting(false);
      setSpotifyConnectError(err?.response?.data?.detail ?? "Could not start Spotify connection. Check server configuration.");
    }
  }

  async function handleDeleteSpotifyConnector() {
    setConnectorRemoving("spotify");
    setConnectorResult(null);
    setSpotifyConnectError(null);
    try {
      await deleteSpotifyConnector();
      setConnectorResult("✓ Spotify disconnected.");
      await loadConnectors();
    } catch (err: any) {
      setConnectorResult(err?.response?.data?.detail ?? "Failed to disconnect Spotify.");
    } finally {
      setConnectorRemoving(null);
    }
  }

  async function runAutoProcess() {
    setSyncing(true); setAutoResult(null);
    try {
      const result = await autoProcessEmails();
      setAutoResult(result);
      await loadEmails();
    } catch { /* silently fail */ } finally { setSyncing(false); }
  }

  async function loadEmails() {
    setEmailsLoading(true);
    try { setEmails(await listEmails()); } catch { /* silently fail */ } finally { setEmailsLoading(false); }
  }

  async function handleDeleteEmail(id: number) {
    try {
      await deleteEmail(id);
      setEmails(prev => prev.filter(e => e.id !== id));
      if (selectedEmail?.id === id) setSelectedEmail(null);
    } catch { /* silently fail */ }
  }

  async function handleEmailToNote(id: number) {
    setActionLoading("note"); setActionResult(null);
    try {
      const res = await emailToNote(id);
      setActionResult(`✓ Saved as note: "${res.title}"`);
    } catch { setActionResult("Failed to save note."); }
    finally { setActionLoading(null); }
  }

  async function handleEmailToReminder(id: number) {
    setActionLoading("reminder"); setActionResult(null);
    try {
      const res = await emailToReminder(id);
      const due = res.due_date ? ` - due ${res.due_date}${res.due_time ? " " + res.due_time : ""}` : "";
      setActionResult(`✓ Reminder added: "${res.text}"${due}`);
    } catch { setActionResult("Failed to add reminder."); }
    finally { setActionLoading(null); }
  }


  async function handleConnectEmail() {
    setEmailConnecting(true);
    setEmailConnectError(null);
    try {
      const url = await getEmailConnectUrl();
      window.location.href = url;
    } catch (err: any) {
      setEmailConnecting(false);
      const detail = err?.response?.data?.detail ?? "Could not start Gmail connection. Check server configuration.";
      setEmailConnectError(detail);
    }
  }

  async function handleDisconnectEmail() {
    setEmailLoading(true);
    try {
      await disconnectEmail();
      setEmailStatus({ connected: false, accounts: [] });
      await loadConnectors();
    } catch { /* silently fail */ } finally {
      setEmailLoading(false);
    }
  }

  // TTS settings - local voice list + saved preferences
  const [ttsVoices, setTtsVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [ttsVoiceName, setTtsVoiceNameState] = useState<string>(() => localStorage.getItem("memolink_tts_voice") ?? "");
  const [ttsRate, setTtsRateState] = useState<number>(() => parseFloat(localStorage.getItem("memolink_tts_rate") ?? "1.0"));
  const [ttsSearch, setTtsSearch] = useState("");

  useEffect(() => {
    function loadVoices() {
      const v = window.speechSynthesis?.getVoices() ?? [];
      if (v.length > 0) setTtsVoices(v);
    }
    loadVoices();
    window.speechSynthesis?.addEventListener("voiceschanged", loadVoices);
    return () => window.speechSynthesis?.removeEventListener("voiceschanged", loadVoices);
  }, []);

  function saveTtsVoice(name: string) {
    setTtsVoiceNameState(name);
    if (name) localStorage.setItem("memolink_tts_voice", name);
    else localStorage.removeItem("memolink_tts_voice");
    // Dispatch storage event so useTTS picks it up if open in another hook instance
    window.dispatchEvent(new Event("memolink_tts_changed"));
  }

  function saveTtsRate(r: number) {
    setTtsRateState(r);
    localStorage.setItem("memolink_tts_rate", String(r));
    window.dispatchEvent(new Event("memolink_tts_changed"));
  }

  async function loadProviders() {
    setProvidersLoading(true);
    try {
      setProviders(await getProviders());
    } catch {
      // silently fail
    } finally {
      setProvidersLoading(false);
    }
  }

  if (!show) return null;

  function resetPw() {
    setCurrentPw(""); setNewPw(""); setConfirmPw("");
    setPwError(null); setPwSuccess(false);
  }

  function handleClose() {
    resetPw();
    setShowAddForm(false);
    setEditingId(null);
    onClose();
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwError(null); setPwSuccess(false);
    if (newPw !== confirmPw) { setPwError("New passwords do not match."); return; }
    if (newPw.length < 8) { setPwError("New password must be at least 8 characters."); return; }
    setPwLoading(true);
    try {
      await changePassword(currentPw, newPw);
      setPwSuccess(true); resetPw();
    } catch (err: any) {
      setPwError(err?.response?.data?.detail ?? "Failed to change password.");
    } finally {
      setPwLoading(false);
    }
  }

  async function handleAddProvider(e: React.FormEvent) {
    e.preventDefault();
    setAddError(null);
    setAddLoading(true);
    try {
      await addProvider({
        name: addForm.name.trim(),
        key: addForm.key.trim(),
        model: addForm.model.trim(),
        base_url: addForm.base_url.trim() || undefined,
      });
      setAddForm(BLANK_FORM);
      setShowAddForm(false);
      await loadProviders();
    } catch (err: any) {
      setAddError(err?.response?.data?.detail ?? "Failed to add provider.");
    } finally {
      setAddLoading(false);
    }
  }

  function startEdit(p: CustomProvider) {
    setEditingId(p.id);
    setEditForm({ name: p.name, key: "", model: p.model, base_url: p.base_url ?? "" });
    setEditError(null);
  }

  async function handleUpdateProvider(e: React.FormEvent) {
    e.preventDefault();
    if (editingId === null) return;
    setEditError(null);
    setEditLoading(true);
    try {
      await updateProvider(editingId, {
        name: editForm.name.trim() || undefined,
        key: editForm.key.trim() || undefined,
        model: editForm.model.trim() || undefined,
        base_url: editForm.base_url.trim(),
      });
      setEditingId(null);
      await loadProviders();
    } catch (err: any) {
      setEditError(err?.response?.data?.detail ?? "Failed to update provider.");
    } finally {
      setEditLoading(false);
    }
  }

  async function handleDeleteProvider(id: number) {
    setDeleteLoadingId(id);
    try {
      await deleteProvider(id);
      if (providers.find((p) => p.id === id)?.model === selectedModel) {
        onModelChange("gpt-4o-mini");
      }
      await loadProviders();
    } catch {
      // silently fail
    } finally {
      setDeleteLoadingId(null);
    }
  }

  const initials = user.email.slice(0, 2).toUpperCase();

  const tabs: { id: Tab; label: string }[] = [
    { id: "profile",  label: "Profile" },
    { id: "security", label: "Security" },
    ...(modelSelectionEnabled ? [{ id: "ai" as Tab, label: "AI Model" }] : []),
    ...(customApiKeysEnabled ? [{ id: "keys" as Tab, label: "API Keys" }] : []),
    ...(ttsEnabled ? [{ id: "tts" as Tab, label: "Text-to-Speech" }] : []),
    { id: "connectors", label: "Connectors" },
    ...(emailEnabled ? [{ id: "email" as Tab, label: "Email" }] : []),
    ...(teamsEnabled ? [{ id: "teams" as Tab, label: "Teams" }] : []),
    ...(whatsappAvailable ? [{ id: "whatsapp" as Tab, label: "WhatsApp" }] : []),
    ...(workflowEnabled ? [{ id: "workflow" as Tab, label: "Workflow" }] : []),
  ];

  const inputCls = "w-full bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-xl px-3 py-2 text-sm text-gray-200 outline-none focus:border-indigo-500 transition";
  const btnPrimary = "px-3 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-xl text-sm font-medium transition whitespace-nowrap";
  const btnGhost = "px-3 py-2 text-gray-400 hover:text-gray-200 hover:bg-[var(--ml-bg-hover)] rounded-xl text-sm font-medium transition whitespace-nowrap";
  const btnDanger = "px-3 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 disabled:opacity-50 rounded-xl text-sm font-medium transition whitespace-nowrap border border-red-500/20";

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={handleClose}>
      <div
        className="bg-[#1a1a24] border border-[var(--ml-bg-hover)] rounded-2xl w-full max-w-[700px] mx-4 max-h-[90vh] overflow-y-auto shadow-2xl text-white"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--ml-bg-hover)]">
          <h2 className="font-semibold text-base">Settings</h2>
          <button onClick={handleClose} className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-500 hover:text-gray-200 hover:bg-[var(--ml-bg-hover)] transition">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex">
          {/* Sidebar */}
          <div className="w-36 border-r border-[var(--ml-bg-hover)] py-3 shrink-0">
            {tabs.map(({ id, label }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`w-full text-left px-4 py-2 text-sm transition ${
                  tab === id ? "text-indigo-400 bg-indigo-500/10 font-medium" : "text-gray-400 hover:text-gray-200 hover:bg-[var(--ml-bg-hover)]"
                }`}
              >
                {label}
                {id === "keys" && providers.length > 0 && (
                  <span className="ml-1.5 text-[10px] bg-indigo-500/20 text-indigo-400 px-1.5 py-0.5 rounded-full">
                    {providers.length}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="flex-1 p-6 overflow-y-auto max-h-[560px]">

            {/* ── Profile ── */}
            {tab === "profile" && (
              <div className="space-y-5">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-full bg-indigo-600 flex items-center justify-center text-lg font-bold">{initials}</div>
                  <div>
                    <p className="text-sm font-medium">{user.email}</p>
                    <p className="text-xs text-gray-500 mt-0.5">MemoLink account</p>
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1 uppercase tracking-wider">Email</label>
                  <div className="bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-xl px-3 py-2.5 text-sm text-gray-300">{user.email}</div>
                  <p className="text-xs text-gray-600 mt-1.5">Email cannot be changed.</p>
                </div>
                {onReplayTour && (
                  <div className="pt-2 border-t border-[var(--ml-bg-hover)]">
                    <label className="block text-xs text-gray-500 mb-2 uppercase tracking-wider">Onboarding</label>
                    <button
                      type="button"
                      onClick={onReplayTour}
                      className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm bg-indigo-600/20 text-indigo-400 hover:bg-indigo-600/30 border border-indigo-500/20 transition"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="currentColor" viewBox="0 0 16 16">
                        <path d="M11.534 7h3.932a.25.25 0 0 1 .192.41l-1.966 2.36a.25.25 0 0 1-.384 0l-1.966-2.36a.25.25 0 0 1 .192-.41m-11 2h3.932a.25.25 0 0 0 .192-.41L2.692 6.23a.25.25 0 0 0-.384 0L.342 8.59A.25.25 0 0 0 .534 9"/>
                        <path fillRule="evenodd" d="M8 3c-1.552 0-2.94.707-3.857 1.818a.5.5 0 1 1-.771-.636A6.002 6.002 0 0 1 13.917 7H12.9A5 5 0 0 0 8 3M3.1 9a5.002 5.002 0 0 0 8.757 2.182.5.5 0 1 1 .771.636A6.002 6.002 0 0 1 2.083 9z"/>
                      </svg>
                      Replay app tour
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* ── Security ── */}
            {tab === "security" && (
              <form onSubmit={handleChangePassword} className="space-y-4">
                <p className="text-sm text-gray-400 mb-2">Change your account password.</p>
                {pwError && <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-xs rounded-xl px-3 py-2">{pwError}</div>}
                {pwSuccess && <div className="bg-green-500/10 border border-green-500/30 text-green-400 text-xs rounded-xl px-3 py-2">Password changed successfully.</div>}
                {[
                  { label: "Current Password", value: currentPw, setter: setCurrentPw },
                  { label: "New Password", value: newPw, setter: setNewPw },
                  { label: "Confirm New Password", value: confirmPw, setter: setConfirmPw },
                ].map(({ label, value, setter }) => (
                  <div key={label}>
                    <label className="block text-xs text-gray-500 mb-1 uppercase tracking-wider">{label}</label>
                    <input type="password" value={value} onChange={(e) => setter(e.target.value)} required className={inputCls} />
                  </div>
                ))}
                <button type="submit" disabled={pwLoading} className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 py-2.5 rounded-xl text-sm font-medium transition">
                  {pwLoading ? "Saving…" : "Change Password"}
                </button>
              </form>
            )}

            {/* ── AI Model ── */}
            {tab === "ai" && (
              <div className="space-y-4">
                <p className="text-sm text-gray-400">Choose the model that powers your chat.</p>

                {/* Built-in models */}
                <div className="flex gap-3 items-start">
                  {(["openai", "gemini", "deepseek"] as const).map((provider) => (
                    <div key={provider} className="flex-1 space-y-1.5">
                      <p className="text-[11px] text-gray-500 uppercase tracking-wider mb-2">
                        {provider === "openai" ? "OpenAI" : provider === "gemini" ? "Google Gemini" : "DeepSeek"}
                      </p>
                      {MODELS.filter((m) => m.provider === provider).map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => onModelChange(m.id)}
                          className={`w-full flex items-center justify-between px-3 py-2 rounded-xl border text-left transition ${
                            selectedModel === m.id
                              ? "border-indigo-500 bg-indigo-500/10 text-indigo-300"
                              : "border-[var(--ml-bg-hover)] bg-[var(--ml-bg-surface)] text-gray-300 hover:border-[#3a3a4a] hover:text-white"
                          }`}
                        >
                          <div>
                            <p className="text-sm font-medium leading-snug">{m.label}</p>
                            <p className="text-[11px] text-gray-500 mt-0.5">{m.description}</p>
                          </div>
                          {selectedModel === m.id && (
                            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-indigo-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>

                {/* Custom providers */}
                {providers.length > 0 && (
                  <div>
                    <p className="text-[11px] text-gray-500 uppercase tracking-wider mb-2">Your Custom Providers</p>
                    <div className="space-y-1.5">
                      {providers.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => onModelChange(p.model)}
                          className={`w-full flex items-center justify-between px-3 py-2 rounded-xl border text-left transition ${
                            selectedModel === p.model
                              ? "border-indigo-500 bg-indigo-500/10 text-indigo-300"
                              : "border-[var(--ml-bg-hover)] bg-[var(--ml-bg-surface)] text-gray-300 hover:border-[#3a3a4a] hover:text-white"
                          }`}
                        >
                          <div>
                            <p className="text-sm font-medium leading-snug">{p.name}</p>
                            <p className="text-[11px] text-gray-500 mt-0.5">{p.model}{p.base_url ? ` · ${p.base_url}` : ""}</p>
                          </div>
                          {selectedModel === p.model && (
                            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-indigo-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {providers.length === 0 && (
                  <p className="text-xs text-gray-600">
                    Add your own providers (Groq, Mistral, Ollama, etc.) in the <button onClick={() => setTab("keys")} className="text-indigo-400 hover:underline">API Keys</button> tab.
                  </p>
                )}
              </div>
            )}

            {/* ── API Keys ── */}
            {tab === "keys" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-200">Custom AI Providers</p>
                    <p className="text-xs text-gray-500 mt-0.5">Any OpenAI-compatible API - Groq, Mistral, Ollama, Together, Perplexity, etc.</p>
                  </div>
                  {!showAddForm && (
                    <button onClick={() => { setShowAddForm(true); setAddForm(BLANK_FORM); setAddError(null); }} className={btnPrimary}>
                      + Add Provider
                    </button>
                  )}
                </div>

                {providersLoading && <p className="text-xs text-gray-500">Loading…</p>}

                {/* Add form */}
                {showAddForm && (
                  <form onSubmit={handleAddProvider} className="bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-xl p-4 space-y-3">
                    <p className="text-xs font-medium text-gray-300 uppercase tracking-wider">New Provider</p>
                    {addError && <p className="text-xs text-red-400">{addError}</p>}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] text-gray-500 mb-1">Provider Name *</label>
                        <input placeholder="e.g. Groq, My Ollama" value={addForm.name} onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))} required className={inputCls} />
                      </div>
                      <div>
                        <label className="block text-[11px] text-gray-500 mb-1">Model ID *</label>
                        <input placeholder="e.g. llama3-8b-8192" value={addForm.model} onChange={(e) => setAddForm((f) => ({ ...f, model: e.target.value }))} required className={inputCls} />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[11px] text-gray-500 mb-1">Base URL <span className="text-gray-600">(optional - leave blank for OpenAI default)</span></label>
                      <input placeholder="https://api.groq.com/openai/v1" value={addForm.base_url} onChange={(e) => setAddForm((f) => ({ ...f, base_url: e.target.value }))} className={inputCls} />
                    </div>
                    <div>
                      <label className="block text-[11px] text-gray-500 mb-1">API Key *</label>
                      <input type="password" placeholder="sk-…" value={addForm.key} onChange={(e) => setAddForm((f) => ({ ...f, key: e.target.value }))} required className={inputCls} />
                    </div>
                    <div className="flex gap-2 pt-1">
                      <button type="submit" disabled={addLoading} className={btnPrimary}>{addLoading ? "Saving…" : "Save Provider"}</button>
                      <button type="button" onClick={() => { setShowAddForm(false); setAddError(null); }} className={btnGhost}>Cancel</button>
                    </div>
                  </form>
                )}

                {/* Provider list */}
                {providers.length === 0 && !showAddForm && !providersLoading && (
                  <div className="bg-[var(--ml-bg-surface)] border border-dashed border-[var(--ml-bg-hover)] rounded-xl px-4 py-6 text-center">
                    <p className="text-sm text-gray-500">No custom providers yet.</p>
                    <p className="text-xs text-gray-600 mt-1">Add any OpenAI-compatible API - Groq, Mistral, Ollama, Together, and more.</p>
                  </div>
                )}

                <div className="space-y-2">
                  {providers.map((p) => (
                    <div key={p.id} className="bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-xl overflow-hidden">
                      {editingId === p.id ? (
                        <form onSubmit={handleUpdateProvider} className="p-4 space-y-3">
                          <p className="text-xs font-medium text-gray-300 uppercase tracking-wider">Edit Provider</p>
                          {editError && <p className="text-xs text-red-400">{editError}</p>}
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-[11px] text-gray-500 mb-1">Provider Name</label>
                              <input value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))} className={inputCls} />
                            </div>
                            <div>
                              <label className="block text-[11px] text-gray-500 mb-1">Model ID</label>
                              <input value={editForm.model} onChange={(e) => setEditForm((f) => ({ ...f, model: e.target.value }))} className={inputCls} />
                            </div>
                          </div>
                          <div>
                            <label className="block text-[11px] text-gray-500 mb-1">Base URL</label>
                            <input placeholder="Leave blank to clear" value={editForm.base_url} onChange={(e) => setEditForm((f) => ({ ...f, base_url: e.target.value }))} className={inputCls} />
                          </div>
                          <div>
                            <label className="block text-[11px] text-gray-500 mb-1">New API Key <span className="text-gray-600">(leave blank to keep existing)</span></label>
                            <input type="password" placeholder="sk-…" value={editForm.key} onChange={(e) => setEditForm((f) => ({ ...f, key: e.target.value }))} className={inputCls} />
                          </div>
                          <div className="flex gap-2 pt-1">
                            <button type="submit" disabled={editLoading} className={btnPrimary}>{editLoading ? "Saving…" : "Save Changes"}</button>
                            <button type="button" onClick={() => { setEditingId(null); setEditError(null); }} className={btnGhost}>Cancel</button>
                          </div>
                        </form>
                      ) : (
                        <div className="flex items-center justify-between px-4 py-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-gray-200">{p.name}</span>
                              {selectedModel === p.model && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-500/15 text-indigo-400 font-medium">Active</span>
                              )}
                            </div>
                            <p className="text-[11px] text-gray-500 mt-0.5 truncate">
                              {p.model}
                              {p.base_url && <span className="text-gray-600"> · {p.base_url}</span>}
                            </p>
                          </div>
                          <div className="flex gap-2 shrink-0 ml-3">
                            <button onClick={() => startEdit(p)} className={btnGhost}>Edit</button>
                            <button
                              onClick={() => handleDeleteProvider(p.id)}
                              disabled={deleteLoadingId === p.id}
                              className={btnDanger}
                            >
                              {deleteLoadingId === p.id ? "…" : "Remove"}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Text-to-Speech ── */}
            {tab === "tts" && (
              <div className="space-y-5">
                <p className="text-sm text-gray-400">Configure the voice used when reading notes and chat messages aloud. Changes apply to the next reading. Uses your browser's built-in speech engine - <span className="text-gray-300">no API key or internet connection required</span>.</p>

                {/* Speed */}
                <div>
                  <label className="block text-xs text-gray-500 mb-2 uppercase tracking-wider">Default Speed</label>
                  <div className="flex gap-2 flex-wrap">
                    {[0.75, 1.0, 1.25, 1.5, 2.0].map(r => (
                      <button
                        key={r}
                        onClick={() => saveTtsRate(r)}
                        className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition ${
                          ttsRate === r
                            ? "bg-indigo-600 border-indigo-500 text-white"
                            : "bg-[var(--ml-bg-surface)] border-[var(--ml-bg-hover)] text-gray-400 hover:border-indigo-500/40 hover:text-gray-200"
                        }`}
                      >
                        {r}×
                      </button>
                    ))}
                  </div>
                </div>

                {/* Voice */}
                <div>
                  <label className="block text-xs text-gray-500 mb-2 uppercase tracking-wider">
                    Voice {ttsVoices.length > 0 ? `(${ttsVoices.length} available)` : "(loading…)"}
                  </label>

                  {ttsVoices.length === 0 ? (
                    <p className="text-xs text-gray-600 bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-xl px-3 py-3">
                      No voices found. Ensure your browser and OS have text-to-speech voices installed.
                    </p>
                  ) : (
                    <>
                      <input
                        value={ttsSearch}
                        onChange={e => setTtsSearch(e.target.value)}
                        placeholder="Search by voice name or language…"
                        className="w-full bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-xl px-3 py-2 text-sm text-gray-300 placeholder-gray-600 focus:outline-none focus:border-indigo-500 mb-2"
                      />
                      <div className="max-h-60 overflow-y-auto rounded-xl border border-[var(--ml-bg-hover)] divide-y divide-[var(--ml-bg-hover)]">
                        {/* Default option */}
                        <button
                          onClick={() => saveTtsVoice("")}
                          className={`w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-[var(--ml-bg-hover)] transition ${!ttsVoiceName ? "bg-indigo-500/10" : ""}`}
                        >
                          <div>
                            <p className={`text-sm ${!ttsVoiceName ? "text-indigo-300 font-medium" : "text-gray-300"}`}>Default (system)</p>
                            <p className="text-[11px] text-gray-600">Browser chooses the best voice automatically</p>
                          </div>
                          {!ttsVoiceName && <span className="w-2 h-2 rounded-full bg-indigo-400 shrink-0" />}
                        </button>
                        {ttsVoices
                          .filter(v => !ttsSearch || v.name.toLowerCase().includes(ttsSearch.toLowerCase()) || v.lang.toLowerCase().includes(ttsSearch.toLowerCase()))
                          .map((v, i) => (
                            <button
                              key={i}
                              onClick={() => saveTtsVoice(v.name)}
                              className={`w-full flex items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-[var(--ml-bg-hover)] transition ${ttsVoiceName === v.name ? "bg-indigo-500/10" : ""}`}
                            >
                              <div className="min-w-0">
                                <p className={`text-sm truncate ${ttsVoiceName === v.name ? "text-indigo-300 font-medium" : "text-gray-300"}`}>{v.name}</p>
                                <p className="text-[11px] text-gray-600">{v.lang} · {v.localService ? "offline" : "online"}</p>
                              </div>
                              {ttsVoiceName === v.name && <span className="w-2 h-2 rounded-full bg-indigo-400 shrink-0" />}
                            </button>
                          ))}
                      </div>
                    </>
                  )}
                </div>

                <div className="bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-xl px-4 py-3">
                  <p className="text-[11px] text-gray-500 leading-relaxed">
                    <span className="text-gray-400">Offline voices</span> work without internet and are faster. <span className="text-gray-400">Online voices</span> (if any) are streamed by the OS and may sound higher quality but require a connection. The voice list is provided by your operating system and cannot be extended through MemoLink.
                  </p>
                </div>
              </div>
            )}

            {/* ── Connectors ── */}
            {tab === "connectors" && (
              <div className="space-y-5">
                <div>
                  <h3 className="text-sm font-semibold text-white mb-1">Connector Hub</h3>
                  <p className="text-xs text-gray-500 leading-relaxed">
                    Manage the external systems MemoLink can act on from chat. OAuth connectors stay connected here, and token-based connectors define the default repo or project your ticket actions should use.
                  </p>
                </div>

                {connectorsError && (
                  <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300 leading-relaxed">
                    {connectorsError}
                  </div>
                )}
                {connectorResult && (
                  <div className={`rounded-xl border px-3 py-2 text-xs leading-relaxed ${connectorResult.startsWith("✓") ? "border-green-500/20 bg-green-500/10 text-green-300" : "border-red-500/20 bg-red-500/10 text-red-300"}`}>
                    {connectorResult}
                  </div>
                )}

                {connectorsLoading ? (
                  <p className="text-xs text-gray-500">Loading connectors…</p>
                ) : (
                  <div className="space-y-4">
                    {connectors
                      .filter((connector) => (connector.id !== "email" || emailEnabled) && (connector.id !== "teams" || teamsEnabled))
                      .map((connector) => (
                      <div key={connector.id} className="border border-[var(--ml-bg-hover)] rounded-xl bg-[var(--ml-bg-surface)] px-4 py-4 space-y-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-medium text-gray-200">{connector.label}</p>
                              <span className={`text-[10px] px-2 py-0.5 rounded-full ${connector.connected ? "bg-green-500/10 text-green-300" : "bg-gray-700 text-gray-300"}`}>
                                {connector.connected ? "Connected" : "Not connected"}
                              </span>
                            </div>
                            <p className="text-xs text-gray-500 mt-1 leading-relaxed">{connector.description}</p>
                            {connector.summary && <p className="text-xs text-gray-400 mt-1">{connector.summary}</p>}
                          </div>

                          {connector.id === "email" && (
                            <div className="flex gap-2 shrink-0">
                              <button onClick={() => setTab("email")} className={btnGhost}>Manage</button>
                              {connector.connected ? (
                                <button onClick={handleDisconnectEmail} disabled={emailLoading} className={btnDanger}>
                                  {emailLoading ? "Disconnecting…" : "Disconnect"}
                                </button>
                              ) : (
                                <button onClick={handleConnectEmail} disabled={emailConnecting} className={btnPrimary}>
                                  {emailConnecting ? "Redirecting…" : "Connect"}
                                </button>
                              )}
                            </div>
                          )}

                          {connector.id === "teams" && (
                            <div className="flex gap-2 shrink-0">
                              <button onClick={() => setTab("teams")} className={btnGhost}>Manage</button>
                              {connector.connected ? (
                                <button onClick={handleTeamsDisconnect} disabled={teamsLoading} className={btnDanger}>
                                  {teamsLoading ? "Disconnecting…" : "Disconnect"}
                                </button>
                              ) : (
                                <button onClick={handleTeamsConnect} disabled={teamsLoading} className={btnPrimary}>
                                  {teamsLoading ? "Redirecting…" : "Connect"}
                                </button>
                              )}
                            </div>
                          )}
                        </div>

                        {connector.id === "github" && (
                          <div className="space-y-3 pt-1">
                            {connector.connected ? (
                              <>
                                <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--ml-bg-hover)] bg-[var(--ml-bg-surface)] px-4 py-3">
                                  <div>
                                    <p className="text-sm font-medium text-gray-200">{connector.summary || "GitHub connected"}</p>
                                    <p className="text-xs text-gray-500">Connected via GitHub OAuth. Set a default repo if you want chat actions to work without repeating owner/repo.</p>
                                  </div>
                                  <button onClick={handleDeleteGitHubConnector} disabled={connectorRemoving === "github"} className={btnDanger}>
                                    {connectorRemoving === "github" ? "Disconnecting…" : "Disconnect"}
                                  </button>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                  <input className={inputCls} placeholder="Default owner or org" value={gitHubForm.owner} onChange={(e) => setGitHubForm((prev) => ({ ...prev, owner: e.target.value }))} />
                                  <input className={inputCls} placeholder="Default repository" value={gitHubForm.repo} onChange={(e) => setGitHubForm((prev) => ({ ...prev, repo: e.target.value }))} />
                                  <input className={inputCls} placeholder="Default branch (optional)" value={gitHubForm.branch} onChange={(e) => setGitHubForm((prev) => ({ ...prev, branch: e.target.value }))} />
                                  <input className={inputCls} placeholder="GitHub API base URL (optional)" value={gitHubForm.base_url} onChange={(e) => setGitHubForm((prev) => ({ ...prev, base_url: e.target.value }))} />
                                </div>
                                <div className="flex gap-2 flex-wrap">
                                  <button onClick={handleSaveGitHubConnector} disabled={connectorSaving === "github"} className={btnPrimary}>
                                    {connectorSaving === "github" ? "Saving…" : "Save Repo Defaults"}
                                  </button>
                                </div>
                                <p className="text-[11px] text-gray-600">MemoLink can inspect repos, manage issues, create and update pull requests, merge them, comment on them, and create development branches from chat.</p>
                              </>
                            ) : (
                              <div className="space-y-4">
                                <p className="text-sm text-gray-400">Connect GitHub to manage issues, pull requests, comments, branches, and repo workflows directly from chat.</p>
                                <div className="bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-xl px-4 py-4 space-y-2.5">
                                  {["Create and update issues and pull requests", "Comment on existing PRs or issues", "Create development branches from chat", "Set a default repo so chat actions stay concise"].map((f) => (
                                    <div key={f} className="flex items-start gap-2 text-xs text-gray-400">
                                      <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 mt-1 shrink-0" />
                                      {f}
                                    </div>
                                  ))}
                                </div>
                                <button onClick={handleConnectGitHub} disabled={githubConnecting} className={btnPrimary}>
                                  {githubConnecting ? "Redirecting…" : "Connect GitHub"}
                                </button>
                                {githubConnectError && (
                                  <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300 leading-relaxed">
                                    {githubConnectError}
                                  </div>
                                )}
                                <p className="text-[11px] text-gray-600">You'll be redirected to GitHub to authorise access. MemoLink stores the access token securely and never stores your password.</p>
                              </div>
                            )}
                          </div>
                        )}

                        {connector.id === "jira" && (
                          <div className="space-y-3 pt-1">
                            {connector.connected ? (
                              <>
                                <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--ml-bg-hover)] bg-[var(--ml-bg-surface)] px-4 py-3">
                                  <div>
                                    <p className="text-sm font-medium text-gray-200">{connector.summary || "Jira connected"}</p>
                                    <p className="text-xs text-gray-500">Connected via Atlassian OAuth. Set a default project if you want chat actions to stay concise.</p>
                                  </div>
                                  <button onClick={handleDeleteJiraConnector} disabled={connectorRemoving === "jira"} className={btnDanger}>
                                    {connectorRemoving === "jira" ? "Disconnecting…" : "Disconnect"}
                                  </button>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                  <input className={inputCls} placeholder="Default project key" value={jiraForm.project_key} onChange={(e) => setJiraForm((prev) => ({ ...prev, project_key: e.target.value }))} />
                                  <input className={inputCls} placeholder="Default issue type" value={jiraForm.issue_type} onChange={(e) => setJiraForm((prev) => ({ ...prev, issue_type: e.target.value }))} />
                                </div>
                                <div className="flex gap-2 flex-wrap">
                                  <button onClick={handleSaveJiraConnector} disabled={connectorSaving === "jira"} className={btnPrimary}>
                                    {connectorSaving === "jira" ? "Saving…" : "Save Project Defaults"}
                                  </button>
                                </div>
                                <p className="text-[11px] text-gray-600">MemoLink can check tickets, create issues, update them, comment on them, inspect transitions, and move them into a new workflow status from chat.</p>
                              </>
                            ) : (
                              <div className="space-y-4">
                                <p className="text-sm text-gray-400">Connect Jira to create tickets, update them, move them into progress, inspect transitions, and comment on work items directly from chat.</p>
                                <div className="bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-xl px-4 py-4 space-y-2.5">
                                  {["Create and update Jira issues from chat", "Move work into statuses like In Progress", "List transitions and comments on an issue", "Set a default project so prompts stay short"].map((f) => (
                                    <div key={f} className="flex items-start gap-2 text-xs text-gray-400">
                                      <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 mt-1 shrink-0" />
                                      {f}
                                    </div>
                                  ))}
                                </div>
                                <button onClick={handleConnectJira} disabled={jiraConnecting} className={btnPrimary}>
                                  {jiraConnecting ? "Redirecting…" : "Connect Jira"}
                                </button>
                                {jiraConnectError && (
                                  <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300 leading-relaxed">
                                    {jiraConnectError}
                                  </div>
                                )}
                                <p className="text-[11px] text-gray-600">You'll be redirected to Atlassian to authorise access. MemoLink stores the access token securely and refreshes it when needed.</p>
                              </div>
                            )}
                          </div>
                        )}

                        {connector.id === "spotify" && (
                          <div className="space-y-3 pt-1">
                            {connector.connected ? (
                              <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--ml-bg-hover)] bg-[var(--ml-bg-surface)] px-4 py-3">
                                <div>
                                  <p className="text-sm font-medium text-gray-200">{connector.summary || "Spotify connected"}</p>
                                  <p className="text-xs text-gray-500">Connected via Spotify OAuth. MemoLink can use this account for playback controls from the lower-right player.</p>
                                </div>
                                <button onClick={handleDeleteSpotifyConnector} disabled={connectorRemoving === "spotify"} className={btnDanger}>
                                  {connectorRemoving === "spotify" ? "Disconnecting…" : "Disconnect"}
                                </button>
                              </div>
                            ) : (
                              <div className="space-y-4">
                                <p className="text-sm text-gray-400">Connect Spotify so MemoLink can control your music account from the lower-right player and full Spotify tab.</p>
                                <div className="bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-xl px-4 py-4 space-y-2.5">
                                  {["Read currently playing track", "Control playback: previous, pause, stop, next", "Open a full Spotify workspace tab", "Keep tokens encrypted with your other connectors"].map((f) => (
                                    <div key={f} className="flex items-start gap-2 text-xs text-gray-400">
                                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 mt-1 shrink-0" />
                                      {f}
                                    </div>
                                  ))}
                                </div>
                                <button onClick={handleConnectSpotify} disabled={spotifyConnecting} className={btnPrimary}>
                                  {spotifyConnecting ? "Redirecting…" : "Connect Spotify"}
                                </button>
                                {spotifyConnectError && (
                                  <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300 leading-relaxed">
                                    {spotifyConnectError}
                                  </div>
                                )}
                                <p className="text-[11px] text-gray-600">You'll be redirected to Spotify to authorise playback access. MemoLink stores the access and refresh tokens securely.</p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── Email ── */}
            {tab === "email" && (
              <div className="space-y-4">
                {emailStatus.connected ? (
                  <>
                    {/* Connected accounts */}
                    <div className="space-y-1.5">
                      {emailStatus.accounts.map((acct) => (
                        <div key={acct.id} className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="w-2 h-2 rounded-full bg-green-400 shrink-0" />
                            <span className="text-xs text-gray-400 truncate">{acct.email}</span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <label className="flex items-center gap-1 text-[10px] text-gray-600" title="Emails per page when browsing">
                              Page size
                              <input
                                type="number"
                                min={5}
                                max={100}
                                defaultValue={acct.page_size ?? 25}
                                disabled={pageSizeSavingId === acct.id}
                                onBlur={async (e) => {
                                  const value = Math.min(100, Math.max(5, Number(e.target.value) || 25));
                                  e.target.value = String(value);
                                  if (value === acct.page_size) return;
                                  setPageSizeSavingId(acct.id);
                                  try {
                                    await updateEmailAccountSettings(acct.id, value);
                                    await loadConnectors();
                                  } catch { /* silently fail */ } finally { setPageSizeSavingId(null); }
                                }}
                                className="w-14 bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded px-1.5 py-0.5 text-[11px] text-gray-300"
                              />
                            </label>
                            <button
                              onClick={async () => {
                                setEmailLoading(true);
                                try {
                                  await disconnectEmail(acct.email);
                                  await loadConnectors();
                                } catch { /* silently fail */ } finally { setEmailLoading(false); }
                              }}
                              disabled={emailLoading}
                              className={btnDanger}
                            >
                              {emailLoading ? "…" : "Remove"}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Sync bar */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <button onClick={runAutoProcess} disabled={syncing} className={btnPrimary}>
                        {syncing ? "Syncing…" : "↻ Refresh"}
                      </button>
                      <button onClick={handleConnectEmail} disabled={emailConnecting} className={btnGhost}>
                        {emailConnecting ? "Redirecting…" : "+ Add account"}
                      </button>
                      {syncing && <span className="text-xs text-gray-500">Syncing emails, creating notes & reminders…</span>}
                      {!syncing && autoResult && (
                        <span className="text-xs text-gray-500">
                          {autoResult.synced > 0
                            ? `${autoResult.synced} new · ${autoResult.notes_added} added to Email Digest · ${autoResult.reminders_created} reminders`
                            : "Up to date"}
                        </span>
                      )}
                    </div>

                    {/* Email detail view */}
                    {selectedEmail ? (
                      <div className="bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-xl overflow-hidden">
                        <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--ml-bg-hover)]">
                          <button onClick={() => setSelectedEmail(null)} className="text-gray-500 hover:text-gray-300 transition">
                            ← Back
                          </button>
                        </div>
                        <div className="px-4 py-3 space-y-1">
                          <p className="text-sm font-semibold text-gray-200">{selectedEmail.subject}</p>
                          <p className="text-xs text-gray-500">
                            {selectedEmail.sender_name || selectedEmail.sender_email}
                            {selectedEmail.sender_name && <span className="text-gray-600"> · {selectedEmail.sender_email}</span>}
                          </p>
                          {selectedEmail.email_date && (
                            <p className="text-xs text-gray-600">{new Date(selectedEmail.email_date).toLocaleString()}</p>
                          )}
                        </div>
                        <div className="px-4 pb-3 max-h-48 overflow-y-auto">
                          <p className="text-xs text-gray-400 whitespace-pre-wrap leading-relaxed">
                            {selectedEmail.body_text || selectedEmail.snippet || "No content"}
                          </p>
                        </div>
                        {/* Action buttons */}
                        <div className="px-4 pb-4 flex flex-col gap-2">
                          {actionResult && (
                            <p className={`text-xs px-3 py-2 rounded-lg ${actionResult.startsWith("✓") ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"}`}>
                              {actionResult}
                            </p>
                          )}
                          <div className="flex gap-2 flex-wrap">
                            <button
                              onClick={() => handleEmailToNote(selectedEmail.id)}
                              disabled={actionLoading !== null}
                              className={btnPrimary}
                            >
                              {actionLoading === "note" ? "Saving…" : "Save as Note"}
                            </button>
                            <button
                              onClick={() => handleEmailToReminder(selectedEmail.id)}
                              disabled={actionLoading !== null}
                              className={btnGhost}
                            >
                              {actionLoading === "reminder" ? "Adding…" : "Add Reminder"}
                            </button>
                            <button
                              onClick={() => handleDeleteEmail(selectedEmail.id)}
                              className={btnDanger}
                            >
                              Delete
                            </button>
                          </div>

                          {/* In-app reply */}
                          <EmailReplyPanel
                            emailRecordId={selectedEmail.id}
                            senderName={selectedEmail.sender_name}
                            senderEmail={selectedEmail.sender_email}
                            subject={selectedEmail.subject}
                            defaultOpen
                          />
                        </div>
                      </div>
                    ) : (
                      /* Email list */
                      <div className="border border-[var(--ml-bg-hover)] rounded-xl overflow-hidden">
                        {emailsLoading ? (
                          <p className="text-xs text-gray-600 px-4 py-6 text-center">Loading…</p>
                        ) : emails.length === 0 ? (
                          <p className="text-xs text-gray-600 px-4 py-6 text-center">
                            No emails yet. Click <span className="text-gray-400">Sync Emails</span> to fetch important emails from Gmail.
                          </p>
                        ) : (
                          <div className="divide-y divide-[var(--ml-bg-hover)] max-h-80 overflow-y-auto">
                            {emails.map(email => (
                              <div
                                key={email.id}
                                className="flex items-start gap-3 px-4 py-3 hover:bg-[var(--ml-bg-hover)] cursor-pointer transition group"
                                onClick={() => { setSelectedEmail(email); setActionResult(null); }}
                              >
                                {/* Importance badge */}
                                <span className={`mt-0.5 shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                  email.importance_score >= 4.5 ? "bg-red-500/20 text-red-400" :
                                  email.importance_score >= 3.5 ? "bg-orange-500/20 text-orange-400" :
                                  "bg-indigo-500/10 text-indigo-400"
                                }`}>
                                  {email.importance_score.toFixed(0)}
                                </span>
                                <div className="min-w-0 flex-1">
                                  <p className={`text-xs truncate ${email.is_read ? "text-gray-400" : "text-gray-200 font-medium"}`}>
                                    {email.subject}
                                  </p>
                                  <p className="text-[11px] text-gray-600 truncate">
                                    {email.sender_name || email.sender_email}
                                  </p>
                                  {email.snippet && (
                                    <p className="text-[11px] text-gray-600 truncate mt-0.5">{email.snippet}</p>
                                  )}
                                </div>
                                <button
                                  onClick={e => { e.stopPropagation(); handleDeleteEmail(email.id); }}
                                  className="shrink-0 opacity-0 group-hover:opacity-100 text-gray-600 hover:text-red-400 transition text-xs px-1"
                                >
                                  ✕
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="space-y-4">
                    <p className="text-sm text-gray-400">Connect Gmail to sync important emails, convert them to notes, and get AI reply suggestions.</p>
                    <div className="bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-xl px-4 py-4 space-y-2.5">
                      {["Sync and filter important emails automatically", "Convert emails into notes with one click", "Create reminders from email deadlines", "Get AI-powered reply suggestions"].map(f => (
                        <div key={f} className="flex items-start gap-2 text-xs text-gray-400">
                          <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 mt-1 shrink-0" />
                          {f}
                        </div>
                      ))}
                    </div>
                    <button onClick={handleConnectEmail} disabled={emailConnecting} className="flex items-center gap-2.5 px-4 py-2.5 bg-white hover:bg-gray-100 disabled:opacity-60 rounded-xl text-sm font-medium text-gray-800 transition">
                      <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                      </svg>
                      {emailConnecting ? "Redirecting to Google…" : "Connect Gmail"}
                    </button>
                    {emailConnectError && (
                      <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300 leading-relaxed">
                        {emailConnectError}
                      </div>
                    )}
                    <p className="text-[11px] text-gray-600">You'll be redirected to Google to authorise access. MemoLink never stores your password.</p>
                  </div>
                )}
              </div>
            )}

            {/* ── Teams ── */}
            {tab === "teams" && (
              <div className="space-y-4">
                {teamsStatus.connected ? (
                  <>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-green-400 shrink-0" />
                        <div>
                          <p className="text-xs text-gray-300">{teamsStatus.display_name}</p>
                          <p className="text-[11px] text-gray-500">{teamsStatus.email}</p>
                        </div>
                      </div>
                      <button onClick={handleTeamsDisconnect} disabled={teamsLoading} className={btnDanger}>
                        {teamsLoading ? "Disconnecting…" : "Disconnect"}
                      </button>
                    </div>

                    {teamsError && (
                      <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-200">
                        {teamsError}
                      </div>
                    )}

                    {selectedChat ? (
                      <div className="bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-xl overflow-hidden">
                        <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--ml-bg-hover)]">
                          <button onClick={() => { setSelectedChat(null); setTeamsSaveResult(null); }} className="text-xs text-gray-500 hover:text-gray-300 transition">← Back</button>
                          <span className="text-xs text-gray-300 font-medium truncate max-w-[180px]">{selectedChat.topic}</span>
                          <button onClick={handleChatToNote} className="text-xs text-indigo-400 hover:text-indigo-300 transition">Save to note</button>
                        </div>
                        {teamsSaveResult && (
                          <p className={`mx-4 mt-2 text-xs px-3 py-1.5 rounded-lg ${teamsSaveResult.startsWith("✓") ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"}`}>{teamsSaveResult}</p>
                        )}
                        <div className="px-4 py-3 max-h-52 overflow-y-auto space-y-2">
                          {teamsMessagesLoading ? (
                            <p className="text-xs text-gray-600">Loading messages…</p>
                          ) : teamsMessages.length === 0 ? (
                            <p className="text-xs text-gray-600">No messages</p>
                          ) : teamsMessages.map((m) => (
                            <div key={m.id} className="space-y-0.5">
                              <p className="text-[11px] text-indigo-400 font-medium">{m.from}</p>
                              <p className="text-xs text-gray-300 leading-snug">{m.content}</p>
                              <p className="text-[10px] text-gray-600">{new Date(m.createdDateTime).toLocaleString()}</p>
                            </div>
                          ))}
                        </div>
                        <div className="px-4 pb-3 flex gap-2">
                          <input
                            type="text"
                            value={teamsReply}
                            onChange={(e) => setTeamsReply(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendTeamsReply(); } }}
                            placeholder="Reply…"
                            className="flex-1 bg-[var(--ml-bg-base)] border border-[var(--ml-bg-hover)] rounded-lg px-3 py-1.5 text-xs text-gray-200 outline-none focus:border-indigo-500"
                          />
                          <button onClick={handleSendTeamsReply} disabled={teamsSending || !teamsReply.trim()} className={btnPrimary}>
                            {teamsSending ? "…" : "Send"}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">Recent Chats</p>
                          <button onClick={loadTeamsChats} disabled={teamsChatsLoading} className="text-xs text-indigo-400 hover:text-indigo-300">
                            {teamsChatsLoading ? "Loading…" : "↻ Refresh"}
                          </button>
                        </div>
                        {teamsChats.length === 0 ? (
                          <p className="text-xs text-gray-600">{teamsChatsLoading ? "Loading…" : teamsError ?? "No chats found"}</p>
                        ) : teamsChats.map((chat) => (
                          <button
                            key={chat.id}
                            onClick={() => handleOpenChat(chat)}
                            className="w-full text-left px-3 py-2.5 bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-xl hover:border-indigo-500/30 transition"
                          >
                            <p className="text-xs text-gray-200 font-medium truncate">{chat.topic}</p>
                            {chat.lastMessagePreview && (
                              <p className="text-[11px] text-gray-500 truncate mt-0.5">{chat.lastMessagePreview}</p>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="space-y-3">
                    <p className="text-xs text-gray-400 leading-relaxed">
                      Connect your Microsoft Teams account to read chats, reply, and save conversations as notes.
                    </p>
                    <button onClick={handleTeamsConnect} disabled={teamsLoading} className={btnPrimary}>
                      {teamsLoading ? "Redirecting…" : "Connect Microsoft Teams"}
                    </button>
                    <p className="text-[11px] text-gray-600">You'll be redirected to Microsoft to authorise access. MemoLink never stores your password.</p>
                  </div>
                )}
              </div>
            )}

            {/* ── WhatsApp ── */}
            {tab === "whatsapp" && (
              <div className="space-y-4">
                {waError && (
                  <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300 leading-relaxed">
                    {waError}
                  </div>
                )}

                {waStatus.connected ? (
                  /* Connected */
                  <>
                    <div className="flex items-center gap-3">
                      <span className="w-2 h-2 rounded-full bg-green-400 shrink-0" />
                      <div className="flex-1">
                        <p className="text-xs text-gray-300 font-medium">WhatsApp Connected</p>
                        <p className="text-[11px] text-gray-500">
                          {waStatus.historySynced
                            ? `${waStatus.chatCount ?? 0} chats, ${waStatus.messageCount ?? 0} messages synced — open the Reminders panel to view.`
                            : "Syncing chat history… this may take up to 30 s."}
                        </p>
                      </div>
                      <button onClick={handleWaDisconnect} disabled={waLoading} className={btnDanger}>
                        {waLoading ? "Stopping…" : "Disconnect"}
                      </button>
                    </div>
                    {!waStatus.historySynced && (
                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        <svg className="w-3.5 h-3.5 animate-spin shrink-0 text-green-400" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                        </svg>
                        Syncing chats and message history from WhatsApp…
                      </div>
                    )}
                    {waStatus.historySynced && (
                      <div className="rounded-xl border border-green-500/20 bg-green-500/5 px-4 py-3 text-xs text-gray-400 leading-relaxed space-y-1">
                        <p className="text-green-400 font-medium">✓ Ready — {waStatus.chatCount ?? 0} chats, {waStatus.messageCount ?? 0} messages loaded</p>
                        <p>Open the Reminders panel → WhatsApp section to browse chats and get AI reply suggestions.</p>
                      </div>
                    )}
                  </>
                ) : waStatus.status === "qr" && waStatus.qr_image ? (
                  /* QR Scan */
                  <div className="flex flex-col items-center gap-3">
                    <p className="text-sm font-medium text-gray-200">Scan with WhatsApp</p>
                    <div className="p-3 bg-white rounded-2xl">
                      <img src={waStatus.qr_image} alt="WhatsApp QR" className="w-52 h-52" />
                    </div>
                    <p className="text-xs text-gray-500 text-center leading-relaxed">
                      Open WhatsApp on your phone → More options → Linked Devices → Link a Device → scan this code.
                    </p>
                    <div className="flex items-center gap-2 text-xs text-gray-600">
                      <svg className="w-3 h-3 animate-spin shrink-0" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                      </svg>
                      Waiting for scan…
                    </div>
                  </div>
                ) : waStatus.status === "connecting" ? (
                  /* Connecting — stuck state shows escape hatches */
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <svg className="w-3.5 h-3.5 animate-spin shrink-0 text-green-400" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                      </svg>
                      Connecting to WhatsApp… (may take up to 30 s)
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={async () => {
                          stopWaPolling();
                          setWaLoading(true);
                          try { await stopWhatsapp(); } catch { /* ignore */ }
                          setWaStatus({ connected: false, status: "disconnected", qr_image: null });
                          onWhatsappDisconnected?.();
                          setWaLoading(false);
                          setWaError(null);
                        }}
                        className="text-xs text-gray-500 hover:text-gray-300 underline underline-offset-2 transition"
                      >
                        Cancel
                      </button>
                      <span className="text-gray-700 text-xs">·</span>
                      <button
                        onClick={async () => {
                          stopWaPolling();
                          setWaStatus({ connected: false, status: "disconnected", qr_image: null });
                          await handleWaConnect(true);
                        }}
                        className="text-xs text-green-400 hover:text-green-300 underline underline-offset-2 transition"
                      >
                        Stuck? Get fresh QR
                      </button>
                    </div>
                  </div>
                ) : (
                  /* Disconnected */
                  <div className="space-y-3">
                    <p className="text-xs text-gray-400 leading-relaxed">
                      Connect your personal WhatsApp account to read conversations, send replies, and get AI suggestions based on your notes — all locally on your machine.
                    </p>
                    <div className="rounded-xl border border-[var(--ml-bg-hover)] bg-[var(--ml-bg-surface)] px-4 py-3 text-[11px] text-gray-500 space-y-1.5">
                      <p className="text-gray-400 font-medium text-xs">Requirements</p>
                      <p>• Node.js must be installed on this machine</p>
                      <p>• WhatsApp app on your phone (personal account)</p>
                      <p>• The bridge runs locally — no data leaves your machine</p>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        onClick={() => handleWaConnect(false)}
                        disabled={waLoading}
                        className={btnPrimary + " flex items-center gap-2"}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="currentColor" viewBox="0 0 16 16">
                          <path d="M13.601 2.326A7.85 7.85 0 0 0 7.994 0C3.627 0 .068 3.558.064 7.926c0 1.399.366 2.76 1.057 3.965L0 16l4.204-1.102a7.9 7.9 0 0 0 3.79.965h.004c4.368 0 7.926-3.558 7.93-7.93A7.9 7.9 0 0 0 13.6 2.326zM7.994 14.521a6.6 6.6 0 0 1-3.356-.92l-.24-.144-2.494.654.666-2.433-.156-.251a6.56 6.56 0 0 1-1.007-3.505c0-3.626 2.957-6.584 6.591-6.584a6.56 6.56 0 0 1 4.66 1.931 6.56 6.56 0 0 1 1.928 4.66c-.004 3.639-2.961 6.592-6.592 6.592m3.615-4.934c-.197-.099-1.17-.578-1.353-.646-.182-.065-.315-.099-.445.099-.133.197-.513.646-.627.775-.114.133-.232.148-.43.05-.197-.1-.836-.308-1.592-.985-.59-.525-.985-1.175-1.103-1.372-.114-.198-.011-.304.088-.403.087-.088.197-.232.296-.346.1-.114.133-.198.198-.33.065-.134.034-.248-.015-.347-.05-.099-.445-1.076-.612-1.47-.16-.389-.323-.335-.445-.34-.114-.007-.247-.007-.38-.007a.73.73 0 0 0-.529.247c-.182.198-.691.677-.691 1.654s.71 1.916.81 2.049c.098.133 1.394 2.132 3.383 2.992.47.205.84.326 1.129.418.475.152.904.129 1.246.08.38-.058 1.171-.48 1.338-.943.164-.464.164-.86.114-.943-.049-.084-.182-.133-.38-.232"/>
                        </svg>
                        {waLoading ? "Starting bridge…" : "Connect WhatsApp"}
                      </button>
                      <button
                        onClick={() => handleWaConnect(true)}
                        disabled={waLoading}
                        className={btnGhost}
                        title="Wipe saved session and show a fresh QR code"
                      >
                        Fresh QR
                      </button>
                    </div>
                    {waLoading && (
                      <p className="text-[11px] text-gray-600">
                        Starting bridge — this may take a moment on first run…
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ── Workflow ── */}
            {tab === "workflow" && (
              <div className="space-y-5">
                <div>
                  <h3 className="text-sm font-semibold text-white mb-1">Workflow Action Suggestions</h3>
                  <p className="text-xs text-gray-500 leading-relaxed">
                    When enabled, MemoLink automatically analyses each AI response and shows quick action buttons - like Save as Note or Add Reminder - directly below relevant messages. Nothing executes without you clicking.
                  </p>
                </div>

                {/* Main toggle */}
                <div className="flex items-center justify-between px-4 py-3.5 bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-xl">
                  <div>
                    <p className="text-sm font-medium text-gray-200">Action suggestions</p>
                    <p className="text-xs text-gray-500 mt-0.5">Show action buttons below AI responses when relevant</p>
                  </div>
                  <button
                    onClick={() => toggleWfSuggestions(!wfSuggestions)}
                    className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${wfSuggestions ? "bg-indigo-600" : "bg-[#252533]"}`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${wfSuggestions ? "translate-x-5" : "translate-x-0"}`} />
                  </button>
                </div>

                {/* Action types reference */}
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Available actions</p>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { icon: "📝", label: "Save as Note", desc: "Save the AI response as a searchable note" },
                      { icon: "⏰", label: "Add Reminder", desc: "Create a reminder from a detected deadline" },
                      { icon: "🌐", label: "Search Web", desc: "Search for additional context online" },
                      { icon: "✅", label: "Extract Tasks", desc: "Pull out action items as a checklist note" },
                      { icon: "📋", label: "Summarise Workspace", desc: "Summarise all notes into one document" },
                      { icon: "📄", label: "Report Outline", desc: "Create a structured outline from notes" },
                    ].map(({ icon, label, desc }) => (
                      <div key={label} className="flex items-start gap-2.5 px-3 py-2.5 bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-xl">
                        <span className="text-base shrink-0 mt-0.5">{icon}</span>
                        <div>
                          <p className="text-xs font-medium text-gray-200">{label}</p>
                          <p className="text-[10px] text-gray-600 mt-0.5 leading-relaxed">{desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-indigo-500/5 border border-indigo-500/15 rounded-xl px-4 py-3">
                  <p className="text-xs text-gray-500 leading-relaxed">
                    Suggestions appear only when the AI response is actionable - short replies and simple questions will not show any buttons. Actions execute only when you click them.
                  </p>
                </div>
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}
