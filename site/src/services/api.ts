import { 
  VideoClip, 
  AnalysisJob, 
  AnalysisResult, 
  DashboardStats, 
  ChatMessage, 
  RAGCitation, 
  DetectionData, 
  DailySummaryItem, 
  CloudConnector 
} from '../types';

export const BACKEND_URL = 'https://backend-5urh.onrender.com';
export const DEFAULT_RENDER_URL = BACKEND_URL;

export const getApiBase = (): string => {
  const envUrl = ((import.meta as any).env?.VITE_API_BASE_URL as string);
  if (envUrl) {
    const clean = envUrl.replace(/\/+$/, '');
    return clean.endsWith('/api') ? clean : `${clean}/api`;
  }
  // When running locally in dev (localhost or 127.0.0.1), use relative /api
  if (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
    return '/api';
  }
  // When running on Vercel or production, default to deployed Render backend
  return `${BACKEND_URL}/api`;
};

export const getBackendOrigin = (): string => {
  const apiBase = getApiBase();
  if (apiBase.startsWith('http://') || apiBase.startsWith('https://')) {
    return apiBase.replace(/\/api\/?$/, '');
  }
  return BACKEND_URL;
};

export const resolveMediaUrl = (url?: string | null): string => {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  const origin = getBackendOrigin();
  if (origin && url.startsWith('/')) {
    return `${origin}${url}`;
  }
  return url;
};

const mapVideoMediaUrls = (v: VideoClip): VideoClip => ({
  ...v,
  thumbnail_url: resolveMediaUrl(v.thumbnail_url),
  video_url: resolveMediaUrl(v.video_url),
  evidence_frames: (v.evidence_frames || []).map(resolveMediaUrl)
});

export const api = {
  getApiBase,
  getBackendOrigin,
  resolveMediaUrl,

  async checkHealth(): Promise<{ status: string; has_groq_key: boolean; version?: string }> {
    const apiBase = getApiBase();
    const res = await fetch(`${apiBase}/health`, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) throw new Error(`Health check failed: ${res.statusText}`);
    return res.json();
  },

  async getVideos(): Promise<{ count: number; videos: VideoClip[] }> {
    const apiBase = getApiBase();
    const res = await fetch(`${apiBase}/videos`);
    if (!res.ok) throw new Error(`Failed to fetch videos: ${res.statusText}`);
    const data = await res.json();
    return {
      ...data,
      videos: (data.videos || []).map(mapVideoMediaUrls)
    };
  },

  async getVideo(id: string): Promise<VideoClip> {
    const apiBase = getApiBase();
    const res = await fetch(`${apiBase}/videos/${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error(`Failed to fetch video: ${res.statusText}`);
    const data = await res.json();
    return mapVideoMediaUrls(data.video);
  },

  async getVideoDetections(id: string): Promise<DetectionData> {
    const apiBase = getApiBase();
    const res = await fetch(`${apiBase}/videos/${encodeURIComponent(id)}/detections`);
    if (!res.ok) throw new Error(`Failed to fetch detections: ${res.statusText}`);
    const data = await res.json();
    return data.detection;
  },

  async searchVideos(query: string, limit = 20): Promise<{ count: number; results: any[] }> {
    const apiBase = getApiBase();
    const res = await fetch(`${apiBase}/videos/search?q=${encodeURIComponent(query)}&limit=${limit}`);
    if (!res.ok) throw new Error(`Search request failed: ${res.statusText}`);
    return res.json();
  },

  async getCloudConnectors(): Promise<{ connectors: CloudConnector[] }> {
    const apiBase = getApiBase();
    const res = await fetch(`${apiBase}/videos/cloud-connectors`);
    if (!res.ok) throw new Error(`Failed to fetch cloud connectors: ${res.statusText}`);
    return res.json();
  },

  async ingestRemoteUrl(url: string, title?: string): Promise<{ success: boolean; message: string; video: VideoClip }> {
    const apiBase = getApiBase();
    const res = await fetch(`${apiBase}/videos/ingest-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, title })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to ingest URL');
    }
    return {
      ...data,
      video: mapVideoMediaUrls(data.video)
    };
  },

  uploadVideo(file: File, onProgress?: (percent: number) => void): Promise<{ success: boolean; message: string; video: VideoClip }> {
    const apiBase = getApiBase();
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${apiBase}/videos/upload`);
      xhr.setRequestHeader('Content-Type', file.type || 'video/mp4');
      xhr.setRequestHeader('x-filename', encodeURIComponent(file.name));

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) {
          const percent = Math.round((e.loaded / e.total) * 100);
          onProgress(percent);
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const data = JSON.parse(xhr.responseText);
            resolve({
              ...data,
              video: mapVideoMediaUrls(data.video)
            });
          } catch {
            resolve({ success: true, message: 'Upload completed', video: {} as any });
          }
        } else {
          try {
            const err = JSON.parse(xhr.responseText);
            reject(new Error(err.error || `Upload failed with HTTP ${xhr.status}`));
          } catch {
            reject(new Error(`Upload failed with HTTP ${xhr.status}`));
          }
        }
      };

      xhr.onerror = () => reject(new Error('Network error during upload'));
      xhr.send(file);
    });
  },

  async startAnalysis(videoIds: string[]): Promise<AnalysisJob> {
    const apiBase = getApiBase();
    const res = await fetch(`${apiBase}/analysis/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ video_ids: videoIds })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || 'Failed to start analysis job');
    }
    const data = await res.json();
    return data.job;
  },

  async getJobs(): Promise<AnalysisJob[]> {
    const apiBase = getApiBase();
    const res = await fetch(`${apiBase}/analysis/jobs`);
    if (!res.ok) throw new Error('Failed to fetch jobs');
    const data = await res.json();
    return data.jobs;
  },

  async getJob(jobId: string): Promise<AnalysisJob> {
    const apiBase = getApiBase();
    const res = await fetch(`${apiBase}/analysis/jobs/${encodeURIComponent(jobId)}`);
    if (!res.ok) throw new Error('Failed to fetch job');
    const data = await res.json();
    return data.job;
  },

  getJobEventSource(jobId: string): EventSource {
    const apiBase = getApiBase();
    return new EventSource(`${apiBase}/analysis/jobs/${encodeURIComponent(jobId)}/events`);
  },

  async getAnalysisResults(): Promise<AnalysisResult[]> {
    const apiBase = getApiBase();
    const res = await fetch(`${apiBase}/analysis/results`);
    if (!res.ok) throw new Error('Failed to fetch analysis results');
    const data = await res.json();
    return data.results;
  },

  async getAnalysisResult(id: string): Promise<AnalysisResult> {
    const apiBase = getApiBase();
    const res = await fetch(`${apiBase}/analysis/results/${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error('Failed to fetch analysis result');
    const data = await res.json();
    return data.result;
  },

  async retryAnalysis(id: string): Promise<AnalysisJob> {
    const apiBase = getApiBase();
    const res = await fetch(`${apiBase}/analysis/results/${encodeURIComponent(id)}/retry`, {
      method: 'POST'
    });
    if (!res.ok) throw new Error('Failed to retry analysis');
    const data = await res.json();
    return data.job;
  },

  async getDashboardStats(): Promise<DashboardStats> {
    const apiBase = getApiBase();
    const res = await fetch(`${apiBase}/dashboard/stats`);
    if (!res.ok) throw new Error('Failed to fetch dashboard stats');
    const data = await res.json();
    return data.stats;
  },

  async getDailySummaries(date?: string, risk?: string): Promise<{ available_dates: string[]; summaries: DailySummaryItem[] }> {
    const params = new URLSearchParams();
    if (date && date !== 'all') params.append('date', date);
    if (risk && risk !== 'all') params.append('risk', risk);
    const queryStr = params.toString() ? `?${params.toString()}` : '';
    const apiBase = getApiBase();
    const res = await fetch(`${apiBase}/dashboard/daily-summary${queryStr}`);
    if (!res.ok) throw new Error('Failed to fetch daily summaries');
    return res.json();
  },

  async askAssistant(message: string, history: ChatMessage[]): Promise<{
    answer: string;
    citations: RAGCitation[];
    model: string;
    grounded: boolean;
    notice?: string;
  }> {
    const apiBase = getApiBase();
    const res = await fetch(`${apiBase}/assistant/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, history })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || 'Failed to consult AI assistant');
    }
    return res.json();
  },

  async askVideo(
    id: string,
    question: string,
    history: { sender: string; text: string }[] = []
  ): Promise<{
    answer: string;
    citations: RAGCitation[];
    model: string;
    grounded: boolean;
  }> {
    const apiBase = getApiBase();
    const res = await fetch(`${apiBase}/videos/${encodeURIComponent(id)}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, history })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || 'Failed to query video intelligence');
    }
    return res.json();
  },

  async deleteVideo(id: string): Promise<{ success: boolean; message: string }> {
    const apiBase = getApiBase();
    const res = await fetch(`${apiBase}/videos/${encodeURIComponent(id)}`, {
      method: 'DELETE'
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || 'Failed to delete video');
    }
    return res.json();
  },

  async clearProcessingJobs(): Promise<{ success: boolean; message: string }> {
    const apiBase = getApiBase();
    const res = await fetch(`${apiBase}/analysis/jobs/clear-processing`, {
      method: 'POST'
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || 'Failed to clear jobs');
    }
    return res.json();
  },

  async getSources(): Promise<any[]> {
    const apiBase = getApiBase();
    const res = await fetch(`${apiBase}/assistant/sources`);
    if (!res.ok) throw new Error('Failed to fetch assistant sources');
    const data = await res.json();
    return data.sources;
  }
};
