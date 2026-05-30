import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "@sinclair/typebox";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseDotEnv(content) {
  const out = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const dotenvPath = path.join(__dirname, ".env");
const localEnv = fs.existsSync(dotenvPath) ? parseDotEnv(fs.readFileSync(dotenvPath, "utf8")) : {};
const historyPath = path.join(__dirname, "suno-history.json");

function cfg(name, fallback = undefined) {
  const value = process.env[name] ?? localEnv[name] ?? fallback;
  if (typeof value !== "string") return value;
  return value.trim();
}

function requireCfg(name) {
  const value = cfg(name);
  if (!value) {
    throw new Error(`Missing required setting ${name}. Copy .env.example to .env and set ${name}.`);
  }
  return value;
}

function jsonResult(data) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(data, null, 2)
      }
    ],
    details: data
  };
}

function readHistory() {
  if (!fs.existsSync(historyPath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(historyPath, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeHistory(entries) {
  fs.writeFileSync(historyPath, `${JSON.stringify(entries.slice(0, 200), null, 2)}\n`, { mode: 0o600 });
}

function rememberTask(entry) {
  const entries = readHistory();
  const now = new Date().toISOString();
  const normalized = {
    createdAt: now,
    updatedAt: now,
    provider: "sunoapi.org-compatible",
    ...entry
  };
  const existingIndex = entries.findIndex((item) =>
    item.taskId && normalized.taskId && item.taskId === normalized.taskId && item.kind === normalized.kind
  );
  if (existingIndex >= 0) {
    entries[existingIndex] = {
      ...entries[existingIndex],
      ...normalized,
      createdAt: entries[existingIndex].createdAt || now,
      updatedAt: now
    };
  } else {
    entries.unshift(normalized);
  }
  writeHistory(entries);
  return normalized;
}

function updateHistoryTask(taskId, patch) {
  const entries = readHistory();
  const now = new Date().toISOString();
  let changed = false;
  const updated = entries.map((entry) => {
    if (entry.taskId !== taskId) return entry;
    changed = true;
    return { ...entry, ...patch, updatedAt: now };
  });
  if (changed) writeHistory(updated);
}

async function readJsonResponse(res) {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function assertSunoOk(json, fallbackMessage) {
  if (json?.code !== undefined && json.code !== 200) {
    throw new Error(`Suno API error ${json.code}: ${json.msg || fallbackMessage}`);
  }
}

function clamp(value, min, max) {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  return Math.max(min, Math.min(max, n));
}

function positiveNumberCfg(name, fallback) {
  const value = Number(cfg(name, fallback));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function normalizeTracks(data) {
  const response = data?.response ?? data ?? {};
  const rawTracks = response?.sunoData ?? response?.data ?? data?.sunoData ?? data?.data ?? [];
  if (!Array.isArray(rawTracks)) return [];

  return rawTracks.map((track) => ({
    id: track.id,
    title: track.title,
    audioUrl: track.audioUrl ?? track.audio_url,
    streamAudioUrl: track.streamAudioUrl ?? track.stream_audio_url,
    imageUrl: track.imageUrl ?? track.image_url,
    imageLargeUrl: track.imageLargeUrl ?? track.image_large_url,
    videoUrl: track.videoUrl ?? track.video_url,
    prompt: track.prompt,
    tags: track.tags,
    duration: track.duration,
    modelName: track.modelName ?? track.model_name,
    createTime: track.createTime ?? track.create_time
  }));
}

function normalizeLyrics(data) {
  const response = data?.response ?? data ?? {};
  const rawLyrics = response?.data ?? data?.data ?? [];
  if (!Array.isArray(rawLyrics)) return [];

  return rawLyrics.map((item) => ({
    title: item.title,
    text: item.text,
    status: item.status,
    errorMessage: item.errorMessage
  }));
}

function sunoBaseUrl() {
  return (cfg("SUNO_BASE_URL", "https://api.sunoapi.org") || "https://api.sunoapi.org").replace(/\/$/, "");
}

async function sunoGet(pathname, searchParams = {}) {
  const url = new URL(`${sunoBaseUrl()}${pathname}`);
  for (const [key, value] of Object.entries(searchParams)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }

  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${requireCfg("SUNO_API_KEY")}`
    }
  });
  const json = await readJsonResponse(res);
  if (!res.ok) {
    throw new Error(`Suno HTTP error ${res.status}: ${json.msg || json.raw || res.statusText}`);
  }
  assertSunoOk(json, `Suno request failed for ${pathname}`);
  return json;
}

async function sunoPost(pathname, body) {
  const res = await fetch(`${sunoBaseUrl()}${pathname}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requireCfg("SUNO_API_KEY")}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const json = await readJsonResponse(res);
  if (!res.ok) {
    throw new Error(`Suno HTTP error ${res.status}: ${json.msg || json.raw || res.statusText}`);
  }
  assertSunoOk(json, `Suno request failed for ${pathname}`);
  return json;
}

const MODEL_ENUM = Type.Union([
  Type.Literal("V4"),
  Type.Literal("V4_5"),
  Type.Literal("V4_5PLUS"),
  Type.Literal("V4_5ALL"),
  Type.Literal("V5"),
  Type.Literal("V5_5")
]);

export default definePluginEntry({
  id: "suno-music",
  name: "Suno Music",
  version: "1.0.0",
  description: "Create songs with Suno API using OpenClaw-generated lyrics and style.",

  register(api) {
    api.registerTool({
      name: "suno_create_song",
      label: "Suno Create Song",
      description:
        "Create a song through Suno API. Use this when the user asks to write or generate a song. Write original lyrics unless the user provided lyrics. Choose a concise musical style with genre, mood, instruments, vocal type, language, and BPM. Do not copy copyrighted lyrics or request an exact living artist style.",
      parameters: Type.Object({
        title: Type.String({
          minLength: 1,
          maxLength: 100,
          description: "Song title. Keep it short."
        }),
        lyrics: Type.Optional(Type.String({
          maxLength: 5000,
          description: "Original lyrics to sing. Required unless instrumental=true. Use [Verse], [Chorus], [Bridge] markers."
        })),
        style: Type.String({
          minLength: 1,
          maxLength: 1000,
          description: "Music style: genre, mood, language, vocal type, BPM, instruments, production style. Example: Hebrew pop rock, warm male vocal, 118 BPM, bright guitars."
        }),
        instrumental: Type.Optional(Type.Boolean({
          description: "true for instrumental music without sung lyrics. Default: false."
        })),
        model: Type.Optional(MODEL_ENUM),
        negativeTags: Type.Optional(Type.String({
          maxLength: 500,
          description: "Styles or traits to avoid. Example: low quality, distorted vocals, clipping."
        })),
        vocalGender: Type.Optional(Type.Union([Type.Literal("m"), Type.Literal("f")], {
          description: "Preferred vocal gender when supported by the selected Suno model."
        })),
        styleWeight: Type.Optional(Type.Number({
          minimum: 0,
          maximum: 1,
          description: "How strongly to follow the provided style, 0.0-1.0."
        })),
        weirdnessConstraint: Type.Optional(Type.Number({
          minimum: 0,
          maximum: 1,
          description: "Creative/weirdness constraint, 0.0-1.0."
        })),
        audioWeight: Type.Optional(Type.Number({
          minimum: 0,
          maximum: 1,
          description: "Audio influence weight, 0.0-1.0, when supported."
        })),
        personaId: Type.Optional(Type.String({
          description: "Optional Suno personaId/voiceId if your account supports it."
        })),
        personaModel: Type.Optional(Type.Union([Type.Literal("style_persona"), Type.Literal("voice_persona")], {
          description: "Persona model type. Use voice_persona only when personaId is a Suno Voice ID and the model supports it."
        }))
      }, { additionalProperties: false }),

      async execute(_toolCallId, params) {
        const apiKey = requireCfg("SUNO_API_KEY");
        const callBackUrl = requireCfg("SUNO_CALLBACK_URL");
        const instrumental = params.instrumental === true;
        const lyrics = typeof params.lyrics === "string" ? params.lyrics.trim() : "";

        if (!instrumental && !lyrics) {
          throw new Error("lyrics is required when instrumental=false. Ask the agent to write original lyrics first.");
        }

        const body = {
          customMode: true,
          instrumental,
          model: params.model || cfg("SUNO_DEFAULT_MODEL", "V4_5ALL"),
          callBackUrl,
          style: params.style,
          title: params.title
        };

        if (!instrumental) body.prompt = lyrics;
        if (params.negativeTags || cfg("SUNO_DEFAULT_NEGATIVE_TAGS")) {
          body.negativeTags = params.negativeTags || cfg("SUNO_DEFAULT_NEGATIVE_TAGS");
        }
        if (params.vocalGender) body.vocalGender = params.vocalGender;
        if (params.personaId) body.personaId = params.personaId;
        if (params.personaModel) body.personaModel = params.personaModel;

        const styleWeight = clamp(params.styleWeight, 0, 1);
        const weirdnessConstraint = clamp(params.weirdnessConstraint, 0, 1);
        const audioWeight = clamp(params.audioWeight, 0, 1);
        if (styleWeight !== undefined) body.styleWeight = styleWeight;
        if (weirdnessConstraint !== undefined) body.weirdnessConstraint = weirdnessConstraint;
        if (audioWeight !== undefined) body.audioWeight = audioWeight;

        const json = await sunoPost("/api/v1/generate", body);

        const taskId = json?.data?.taskId;
        if (!taskId) {
          throw new Error(`Suno response did not include data.taskId: ${JSON.stringify(json)}`);
        }

        rememberTask({
          kind: "music",
          taskId,
          status: "submitted",
          title: params.title,
          style: params.style,
          instrumental,
          model: body.model,
          operationType: "generate"
        });

        return jsonResult({
          ok: true,
          provider: "sunoapi.org-compatible",
          status: "submitted",
          taskId,
          title: params.title,
          style: params.style,
          instrumental,
          next: `Call suno_song_status with taskId=${taskId} until status is SUCCESS.`
        });
      }
    });

    api.registerTool({
      name: "suno_generate_lyrics",
      label: "Suno Generate Lyrics",
      description:
        "Create song lyrics through Suno API without generating audio. Use this when the user wants lyric options before creating a full song.",
      parameters: Type.Object({
        prompt: Type.String({
          minLength: 1,
          maxLength: 200,
          description:
            "Detailed lyrics brief: theme, language, mood, genre, point of view, and structure. Suno limits this prompt to 200 characters."
        })
      }, { additionalProperties: false }),

      async execute(_toolCallId, params) {
        const callBackUrl = requireCfg("SUNO_CALLBACK_URL");
        const json = await sunoPost("/api/v1/lyrics", {
          prompt: params.prompt,
          callBackUrl
        });

        const taskId = json?.data?.taskId;
        if (!taskId) {
          throw new Error(`Suno lyrics response did not include data.taskId: ${JSON.stringify(json)}`);
        }

        rememberTask({
          kind: "lyrics",
          taskId,
          status: "submitted",
          prompt: params.prompt
        });

        return jsonResult({
          ok: true,
          provider: "sunoapi.org-compatible",
          status: "submitted",
          taskId,
          prompt: params.prompt,
          next: `Call suno_lyrics_status with taskId=${taskId} until status is SUCCESS.`
        });
      }
    });

    api.registerTool({
      name: "suno_lyrics_status",
      label: "Suno Lyrics Status",
      description: "Check a Suno lyrics-generation task and return generated lyric variations when ready.",
      parameters: Type.Object({
        taskId: Type.String({
          minLength: 1,
          description: "The taskId returned by suno_generate_lyrics."
        })
      }, { additionalProperties: false }),

      async execute(_toolCallId, params) {
        const json = await sunoGet("/api/v1/lyrics/record-info", { taskId: params.taskId });
        const data = json?.data ?? {};
        const lyrics = normalizeLyrics(data);

        updateHistoryTask(params.taskId, {
          status: data.status,
          type: data.type,
          errorCode: data.errorCode,
          errorMessage: data.errorMessage,
          resultCount: lyrics.length,
          titles: lyrics.map((item) => item.title).filter(Boolean)
        });

        return jsonResult({
          ok: true,
          provider: "sunoapi.org-compatible",
          taskId: data.taskId ?? params.taskId,
          status: data.status,
          type: data.type,
          errorCode: data.errorCode,
          errorMessage: data.errorMessage,
          lyrics,
          ready: data.status === "SUCCESS" || lyrics.some((item) => item.text)
        });
      }
    });

    api.registerTool({
      name: "suno_credit_status",
      label: "Suno Credit Status",
      description:
        "Check the current Suno API credit balance and whether there are enough credits to start another song generation task.",
      parameters: Type.Object({
        minimumCredits: Type.Optional(Type.Number({
          minimum: 1,
          description:
            "Minimum credits required before reporting that a new song can be created. Defaults to SUNO_GENERATION_MIN_CREDITS or 10."
        }))
      }, { additionalProperties: false }),

      async execute(_toolCallId, params) {
        const apiKey = requireCfg("SUNO_API_KEY");
        const minimumCredits =
          clamp(params.minimumCredits, 1, Number.MAX_SAFE_INTEGER) ??
          positiveNumberCfg("SUNO_GENERATION_MIN_CREDITS", 10);

        const res = await fetch(`${sunoBaseUrl()}/api/v1/generate/credit`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${apiKey}`
          }
        });

        const json = await readJsonResponse(res);
        if (!res.ok) {
          throw new Error(`Suno HTTP error ${res.status}: ${json.msg || json.raw || res.statusText}`);
        }
        assertSunoOk(json, "Failed to read Suno credit balance");

        const credits = Number(json?.data);
        if (!Number.isFinite(credits)) {
          throw new Error(`Suno credit response did not include numeric data: ${JSON.stringify(json)}`);
        }

        const canCreateSong = credits >= minimumCredits;
        return jsonResult({
          ok: true,
          provider: "sunoapi.org-compatible",
          credits,
          minimumCreditsForSong: minimumCredits,
          canCreateSong,
          shortAnswer: canCreateSong
            ? `You can create a song now. Available credits: ${credits}.`
            : `Not enough credits to create a song now. Available credits: ${credits}; expected minimum: ${minimumCredits}.`,
          nextSongAvailable:
            canCreateSong
              ? "now"
              : "unknown_from_api; wait for the account plan to reset or add credits in the Suno API dashboard",
          note:
            "The sunoapi.org credit endpoint returns the current credit balance only; it does not expose an exact credit reset time."
        });
      }
    });

    api.registerTool({
      name: "suno_generate_persona",
      label: "Suno Generate Persona",
      description:
        "Create a reusable Suno Persona from a completed generated track. Requires a completed music taskId and an audioId from suno_song_status.",
      parameters: Type.Object({
        taskId: Type.String({
          minLength: 1,
          description: "Completed music generation taskId from suno_create_song, extend, or mashup."
        }),
        audioId: Type.String({
          minLength: 1,
          description: "Audio ID from a completed track. In suno_song_status this is the track id."
        }),
        name: Type.String({
          minLength: 1,
          maxLength: 100,
          description: "Short descriptive persona name."
        }),
        description: Type.String({
          minLength: 1,
          maxLength: 1000,
          description: "Detailed musical characteristics, genre, mood, instrumentation, and vocal qualities."
        }),
        style: Type.Optional(Type.String({
          maxLength: 200,
          description: "Optional music style label for the persona."
        })),
        vocalStart: Type.Optional(Type.Number({
          minimum: 0,
          description: "Optional analysis start time in seconds. Segment length must be 10-30 seconds."
        })),
        vocalEnd: Type.Optional(Type.Number({
          minimum: 0,
          description: "Optional analysis end time in seconds. Segment length must be 10-30 seconds."
        }))
      }, { additionalProperties: false }),

      async execute(_toolCallId, params) {
        const body = {
          taskId: params.taskId,
          audioId: params.audioId,
          name: params.name,
          description: params.description
        };
        if (params.style) body.style = params.style;
        const vocalStart = clamp(params.vocalStart, 0, Number.MAX_SAFE_INTEGER);
        const vocalEnd = clamp(params.vocalEnd, 0, Number.MAX_SAFE_INTEGER);
        if (vocalStart !== undefined) body.vocalStart = vocalStart;
        if (vocalEnd !== undefined) body.vocalEnd = vocalEnd;

        const json = await sunoPost("/api/v1/generate/generate-persona", body);
        const data = json?.data ?? {};
        const personaId = data.personaId;
        if (!personaId) {
          throw new Error(`Suno persona response did not include data.personaId: ${JSON.stringify(json)}`);
        }

        rememberTask({
          kind: "persona",
          taskId: params.taskId,
          audioId: params.audioId,
          personaId,
          status: "created",
          name: data.name ?? params.name,
          description: data.description ?? params.description,
          style: params.style
        });

        return jsonResult({
          ok: true,
          provider: "sunoapi.org-compatible",
          personaId,
          name: data.name ?? params.name,
          description: data.description ?? params.description,
          sourceTaskId: params.taskId,
          sourceAudioId: params.audioId,
          next: "Use this personaId in suno_create_song when you want a similar style/persona."
        });
      }
    });

    api.registerTool({
      name: "suno_song_status",
      label: "Suno Song Status",
      description: "Check the status of a Suno music-generation task and return audio URLs when the task is ready.",
      parameters: Type.Object({
        taskId: Type.String({
          minLength: 1,
          description: "The taskId returned by suno_create_song."
        })
      }, { additionalProperties: false }),

      async execute(_toolCallId, params) {
        const apiKey = requireCfg("SUNO_API_KEY");
        const url = new URL(`${sunoBaseUrl()}/api/v1/generate/record-info`);
        url.searchParams.set("taskId", params.taskId);

        const res = await fetch(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${apiKey}`
          }
        });

        const json = await readJsonResponse(res);
        if (!res.ok) {
          throw new Error(`Suno HTTP error ${res.status}: ${json.msg || json.raw || res.statusText}`);
        }
        assertSunoOk(json, "Failed to read Suno task status");

        const data = json?.data ?? {};
        const tracks = normalizeTracks(data);

        updateHistoryTask(params.taskId, {
          status: data.status,
          type: data.type,
          operationType: data.operationType,
          errorCode: data.errorCode,
          errorMessage: data.errorMessage,
          trackCount: tracks.length,
          tracks: tracks.map((track) => ({
            id: track.id,
            title: track.title,
            audioUrl: track.audioUrl,
            streamAudioUrl: track.streamAudioUrl,
            imageUrl: track.imageUrl,
            duration: track.duration,
            createTime: track.createTime
          }))
        });

        return jsonResult({
          ok: true,
          provider: "sunoapi.org-compatible",
          taskId: data.taskId ?? params.taskId,
          status: data.status,
          type: data.type,
          errorCode: data.errorCode,
          errorMessage: data.errorMessage,
          tracks,
          ready: data.status === "SUCCESS" || tracks.some((t) => t.audioUrl || t.streamAudioUrl)
        });
      }
    });

    api.registerTool({
      name: "suno_user_records",
      label: "Suno User Records",
      description:
        "List the local Suno task library recorded by this plugin, or refresh one known Suno taskId from the API. Use this to find previous songs, lyrics tasks, and personas created here.",
      parameters: Type.Object({
        action: Type.Optional(Type.Union([
          Type.Literal("list"),
          Type.Literal("refresh_music"),
          Type.Literal("refresh_lyrics")
        ], {
          description: "list returns local history. refresh_music/refresh_lyrics fetch latest details for a known taskId."
        })),
        taskId: Type.Optional(Type.String({
          minLength: 1,
          description: "Required for refresh_music or refresh_lyrics."
        })),
        limit: Type.Optional(Type.Number({
          minimum: 1,
          maximum: 50,
          description: "Maximum local records to return for action=list. Default: 20."
        })),
        kind: Type.Optional(Type.Union([
          Type.Literal("music"),
          Type.Literal("lyrics"),
          Type.Literal("persona")
        ], {
          description: "Optional local history filter."
        }))
      }, { additionalProperties: false }),

      async execute(_toolCallId, params) {
        const action = params.action || "list";
        if (action === "list") {
          const limit = clamp(params.limit, 1, 50) ?? 20;
          const records = readHistory()
            .filter((entry) => !params.kind || entry.kind === params.kind)
            .slice(0, limit);
          return jsonResult({
            ok: true,
            provider: "sunoapi.org-compatible",
            source: "local-plugin-history",
            count: records.length,
            records
          });
        }

        if (!params.taskId) {
          throw new Error(`taskId is required for action=${action}.`);
        }

        if (action === "refresh_music") {
          const json = await sunoGet("/api/v1/generate/record-info", { taskId: params.taskId });
          const data = json?.data ?? {};
          const tracks = normalizeTracks(data);
          rememberTask({
            kind: "music",
            taskId: data.taskId ?? params.taskId,
            status: data.status,
            type: data.type,
            operationType: data.operationType,
            errorCode: data.errorCode,
            errorMessage: data.errorMessage,
            trackCount: tracks.length,
            tracks: tracks.map((track) => ({
              id: track.id,
              title: track.title,
              audioUrl: track.audioUrl,
              streamAudioUrl: track.streamAudioUrl,
              imageUrl: track.imageUrl,
              duration: track.duration,
              createTime: track.createTime
            }))
          });
          return jsonResult({
            ok: true,
            provider: "sunoapi.org-compatible",
            source: "api",
            taskId: data.taskId ?? params.taskId,
            status: data.status,
            type: data.type,
            operationType: data.operationType,
            tracks
          });
        }

        const json = await sunoGet("/api/v1/lyrics/record-info", { taskId: params.taskId });
        const data = json?.data ?? {};
        const lyrics = normalizeLyrics(data);
        rememberTask({
          kind: "lyrics",
          taskId: data.taskId ?? params.taskId,
          status: data.status,
          type: data.type,
          errorCode: data.errorCode,
          errorMessage: data.errorMessage,
          resultCount: lyrics.length,
          titles: lyrics.map((item) => item.title).filter(Boolean)
        });
        return jsonResult({
          ok: true,
          provider: "sunoapi.org-compatible",
          source: "api",
          taskId: data.taskId ?? params.taskId,
          status: data.status,
          type: data.type,
          lyrics
        });
      }
    });
  }
});
