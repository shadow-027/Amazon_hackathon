import React, { useState, useEffect } from 'react';
import { 
  X, 
  Upload, 
  Cloud, 
  Link as LinkIcon, 
  CheckCircle, 
  AlertTriangle, 
  Loader2, 
  Server, 
  ShieldCheck, 
  ExternalLink 
} from 'lucide-react';
import { api } from '../../services/api';
import { CloudConnector } from '../../types';

interface VideoInputModalProps {
  isOpen: boolean;
  onClose: () => void;
  onVideoAdded?: () => void;
}

export const VideoInputModal: React.FC<VideoInputModalProps> = ({
  isOpen,
  onClose,
  onVideoAdded
}) => {
  const [tab, setTab] = useState<'upload' | 'cloud' | 'url'>('upload');
  const [cloudConnectors, setCloudConnectors] = useState<CloudConnector[]>([]);
  const [isLoadingConnectors, setIsLoadingConnectors] = useState(false);

  // Direct URL state
  const [streamUrl, setStreamUrl] = useState('');
  const [streamTitle, setStreamTitle] = useState('');
  const [urlSubmitting, setUrlSubmitting] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [urlSuccess, setUrlSuccess] = useState<string | null>(null);

  // Upload state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && tab === 'cloud') {
      setIsLoadingConnectors(true);
      api.getCloudConnectors()
        .then((res) => setCloudConnectors(res.connectors))
        .catch(() => setCloudConnectors([]))
        .finally(() => setIsLoadingConnectors(false));
    }
  }, [isOpen, tab]);

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Validate file format
      const validTypes = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo'];
      if (!validTypes.includes(file.type) && !file.name.endsWith('.mp4')) {
        setUploadError('Invalid format. Please select an MP4, MOV, or WEBM video file.');
        setSelectedFile(null);
        return;
      }
      // Validate file size (150MB limit)
      if (file.size > 150 * 1024 * 1024) {
        setUploadError('File exceeds 150MB limit. For larger files, use direct streaming.');
        setSelectedFile(null);
        return;
      }
      setUploadError(null);
      setSelectedFile(file);
    }
  };

  const handleUploadSubmit = async () => {
    if (!selectedFile) return;
    setUploadProgress(5);
    setUploadError(null);
    setUploadSuccess(null);

    try {
      const res = await api.uploadVideo(selectedFile, (percent) => {
        setUploadProgress(percent);
      });
      setUploadProgress(100);
      setUploadSuccess(res.message || `Video "${selectedFile.name}" uploaded successfully!`);
      setSelectedFile(null);
      if (onVideoAdded) onVideoAdded();
    } catch (err: any) {
      setUploadError(err.message || 'Upload failed');
      setUploadProgress(null);
    }
  };

  const handleUrlSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!streamUrl.trim()) return;
    setUrlSubmitting(true);
    setUrlError(null);
    setUrlSuccess(null);

    try {
      const res = await api.ingestRemoteUrl(streamUrl.trim(), streamTitle.trim());
      setUrlSuccess(res.message);
      setStreamUrl('');
      setStreamTitle('');
      if (onVideoAdded) onVideoAdded();
    } catch (err: any) {
      setUrlError(err.message || 'Failed to ingest URL');
    } finally {
      setUrlSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
          <div>
            <h3 className="text-lg font-bold text-slate-900">Add Footage for AI Analysis</h3>
            <p className="text-xs text-slate-500">Submit local videos, link remote surveillance feeds, or connect cloud buckets</p>
          </div>
          <button 
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200 transition"
          >
            <X size={20} />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-slate-200 bg-white px-6 gap-6">
          <button
            onClick={() => setTab('upload')}
            className={`py-3 text-sm font-semibold flex items-center gap-2 border-b-2 transition ${
              tab === 'upload'
                ? 'border-emerald-600 text-emerald-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Upload size={16} /> Direct Upload
          </button>
          <button
            onClick={() => setTab('cloud')}
            className={`py-3 text-sm font-semibold flex items-center gap-2 border-b-2 transition ${
              tab === 'cloud'
                ? 'border-emerald-600 text-emerald-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Cloud size={16} /> Cloud Storage
          </button>
          <button
            onClick={() => setTab('url')}
            className={`py-3 text-sm font-semibold flex items-center gap-2 border-b-2 transition ${
              tab === 'url'
                ? 'border-emerald-600 text-emerald-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <LinkIcon size={16} /> YouTube / Video URL
          </button>
        </div>

        {/* Tab Content */}
        <div className="p-6 overflow-y-auto flex-1">
          {tab === 'upload' && (
            <div className="space-y-4">
              <label 
                htmlFor="file-upload" 
                className="border-2 border-dashed border-slate-300 hover:border-emerald-500 rounded-xl p-8 flex flex-col items-center justify-center cursor-pointer transition bg-slate-50/50 hover:bg-emerald-50/30 group"
              >
                <div className="p-4 bg-emerald-100/70 text-emerald-700 rounded-full mb-3 group-hover:scale-105 transition">
                  <Upload size={28} />
                </div>
                <p className="text-sm font-bold text-slate-800">Click to select doorbell security clip</p>
                <p className="text-xs text-slate-500 mt-1">Supports MP4, MOV, WEBM (Max 150MB)</p>
                <input 
                  id="file-upload" 
                  type="file" 
                  accept="video/mp4,video/quicktime,video/webm" 
                  className="hidden" 
                  onChange={handleFileChange} 
                />
              </label>

              {selectedFile && (
                <div className="p-4 bg-slate-100 rounded-xl flex items-center justify-between">
                  <div>
                    <p className="text-sm font-bold text-slate-800">{selectedFile.name}</p>
                    <p className="text-xs text-slate-500">{(selectedFile.size / (1024 * 1024)).toFixed(2)} MB</p>
                  </div>
                  <button
                    onClick={handleUploadSubmit}
                    disabled={uploadProgress !== null && uploadProgress < 100}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm rounded-lg shadow-sm transition disabled:opacity-50"
                  >
                    {uploadProgress !== null && uploadProgress < 100 ? 'Processing...' : 'Upload & Analyze'}
                  </button>
                </div>
              )}

              {uploadProgress !== null && (
                <div className="space-y-1">
                  <div className="flex justify-between text-xs font-semibold text-slate-600">
                    <span>Validation & Extraction</span>
                    <span>{uploadProgress}%</span>
                  </div>
                  <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
                    <div 
                      className="bg-emerald-600 h-full transition-all duration-300"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                </div>
              )}

              {uploadError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs flex items-center gap-2">
                  <AlertTriangle size={16} />
                  <span>{uploadError}</span>
                </div>
              )}

              {uploadSuccess && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs flex items-center gap-2">
                  <CheckCircle size={16} />
                  <span>{uploadSuccess}</span>
                </div>
              )}
            </div>
          )}

          {tab === 'cloud' && (
            <div className="space-y-4">
              <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-900 leading-relaxed flex items-start gap-3">
                <ShieldCheck size={20} className="text-blue-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold text-sm mb-1">Authorized Cloud Surveillance Ingestion</p>
                  <p>
                    Cloud storage ingestion requires server-side credentials configured in your backend <code className="bg-blue-100 px-1 py-0.5 rounded font-mono">.env</code> file. The platform strictly enforces least-privilege read access and range-based streaming to avoid downloading massive video archives.
                  </p>
                </div>
              </div>

              {isLoadingConnectors ? (
                <div className="flex items-center justify-center p-8">
                  <Loader2 className="animate-spin text-emerald-600" size={24} />
                </div>
              ) : (
                <div className="space-y-3">
                  {cloudConnectors.map((c) => (
                    <div key={c.id} className="p-4 border border-slate-200 rounded-xl hover:border-slate-300 transition bg-slate-50/50">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <Server size={18} className="text-slate-600" />
                          <span className="font-bold text-sm text-slate-800">{c.provider}</span>
                        </div>
                        <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                          c.status === 'connected' 
                            ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' 
                            : 'bg-amber-100 text-amber-800 border border-amber-300'
                        }`}>
                          {c.status}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 mb-2">{c.description}</p>
                      <div className="text-[11px] text-slate-500">
                        <span className="font-semibold">Required env vars: </span>
                        <code className="text-slate-700 bg-slate-200/70 px-1 py-0.5 rounded">{c.requires.join(', ')}</code>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'url' && (
            <form onSubmit={handleUrlSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  YouTube Video Link or Direct MP4 Stream URL
                </label>
                <input
                  type="url"
                  required
                  placeholder="https://www.youtube.com/watch?v=... or https://youtu.be/... or .mp4 stream"
                  value={streamUrl}
                  onChange={(e) => setStreamUrl(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Optional Video Title / Camera Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. Porch Doorbell Footage (Evening)"
                  value={streamTitle}
                  onChange={(e) => setStreamTitle(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-[11px] text-emerald-950 leading-relaxed flex items-start gap-2">
                <CheckCircle size={15} className="text-emerald-700 shrink-0 mt-0.5" />
                <span>
                  <strong>YouTube Ingestion Active:</strong> YouTube doorbell security footage and publicly accessible streams are safely downloaded into your local video repository using yt-dlp for frame extraction and AI telemetry.
                </span>
              </div>

              {urlError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs flex items-center gap-2">
                  <AlertTriangle size={16} />
                  <span>{urlError}</span>
                </div>
              )}

              {urlSuccess && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs flex items-center gap-2">
                  <CheckCircle size={16} />
                  <span>{urlSuccess}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={urlSubmitting || !streamUrl.trim()}
                className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm rounded-xl shadow-sm transition disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {urlSubmitting ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    <span>Downloading & Ingesting Video...</span>
                  </>
                ) : (
                  <>
                    <ExternalLink size={16} />
                    <span>Download & Ingest Video</span>
                  </>
                )}
              </button>
            </form>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 text-sm font-semibold rounded-lg transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
