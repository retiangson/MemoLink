export interface ModelOption {
  id: string;
  label: string;
  provider: "openai" | "gemini" | "deepseek";
  description: string;
}

export const MODELS: ModelOption[] = [
  // OpenAI
  { id: "gpt-4o-mini",   label: "GPT-4o Mini",        provider: "openai", description: "Fast & affordable" },
  { id: "gpt-4o",        label: "GPT-4o",              provider: "openai", description: "Most capable GPT-4" },
  { id: "gpt-4-turbo",   label: "GPT-4 Turbo",         provider: "openai", description: "128k context window" },
  { id: "gpt-3.5-turbo", label: "GPT-3.5 Turbo",       provider: "openai", description: "Fast, legacy" },
  // Gemini (free tier via Google AI Studio)
  { id: "gemini-2.0-flash",      label: "Gemini 2.0 Flash",      provider: "gemini",   description: "Free · latest & fast" },
  { id: "gemini-2.0-flash-lite", label: "Gemini 2.0 Flash Lite",  provider: "gemini",   description: "Free · lightest & fastest" },
  { id: "gemini-1.5-flash-8b",   label: "Gemini 1.5 Flash 8B",   provider: "gemini",   description: "Free · lightweight" },
  { id: "gemini-1.5-pro",        label: "Gemini 1.5 Pro",         provider: "gemini",   description: "Free · more capable" },
  // DeepSeek
  { id: "deepseek-chat",         label: "DeepSeek V3",            provider: "deepseek", description: "Fast · highly capable" },
  { id: "deepseek-reasoner",     label: "DeepSeek R1",            provider: "deepseek", description: "Advanced reasoning" },
  { id: "deepseek-coder",        label: "DeepSeek Coder",         provider: "deepseek", description: "Optimised for code" },
];

export const DEFAULT_MODEL = "gpt-4o-mini";
export const MODEL_STORAGE_KEY = "memolink_model";

export function getSavedModel(): string {
  return localStorage.getItem(MODEL_STORAGE_KEY) || DEFAULT_MODEL;
}

export function saveModel(id: string): void {
  localStorage.setItem(MODEL_STORAGE_KEY, id);
}
