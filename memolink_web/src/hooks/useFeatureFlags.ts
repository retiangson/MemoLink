import { useState, useEffect } from "react";
import { fetchFeatureFlags, type FeatureFlags } from "../api/adminApi";

const DEFAULT_FLAGS: FeatureFlags = {
  web_search_enabled: true,
  agent_mode_enabled: true,
  model_selection_enabled: true,
  image_generation_enabled: true,
  translation_enabled: true,
  file_upload_enabled: true,
  research_mode_enabled: true,
  model_attribution_enabled: true,
  tts_enabled: true,
  slash_commands_enabled: true,
  custom_api_keys_enabled: true,
  video_import_enabled: true,
  email_enabled: true,
  memograph_enabled: true,
  default_model: "gpt-4o-mini",
  default_language: "English",
  web_search_min_level: "regular",
  agent_mode_min_level: "regular",
  model_selection_min_level: "regular",
  image_generation_min_level: "regular",
  translation_min_level: "regular",
  file_upload_min_level: "regular",
  research_mode_min_level: "regular",
  model_attribution_min_level: "regular",
  tts_min_level: "regular",
  slash_commands_min_level: "regular",
  custom_api_keys_min_level: "regular",
  video_import_min_level: "regular",
};

export function useFeatureFlags() {
  const [flags, setFlags] = useState<FeatureFlags>(DEFAULT_FLAGS);
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      const f = await fetchFeatureFlags();
      setFlags(f);
    } catch {
      // Keep defaults on error
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  return { flags, loading, refetch: load };
}
