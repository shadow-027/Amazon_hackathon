import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { videoService } from '../services/videoService.js';
import { storageService } from '../services/storageService.js';
import { ragService } from '../services/ragService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');
const UPLOADS_DIR = path.join(ROOT_DIR, 'clips', 'uploaded');
const DOWNLOAD_SCRIPT = path.join(ROOT_DIR, 'pipeline', 'download_stream.py');

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const router = Router();

// GET /api/videos - List all videos (all 41 dataset clips + user uploads)
router.get('/', (req, res) => {
  try {
    const videos = videoService.getAllVideos();
    res.json({
      success: true,
      count: videos.length,
      videos
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/videos/search - Universal search across filenames, descriptions, timeline, objects, and risk evidence
router.get('/search', (req, res) => {
  try {
    const query = req.query.q || '';
    const limit = parseInt(req.query.limit, 10) || 20;
    const results = ragService.search(query, limit);
    res.json({
      success: true,
      query,
      count: results.length,
      results
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/videos/cloud-connectors - Cloud storage connector status
router.get('/cloud-connectors', (req, res) => {
  const s3Configured = Boolean(process.env.AWS_S3_BUCKET && process.env.AWS_ACCESS_KEY_ID);
  const gcsConfigured = Boolean(process.env.GCS_BUCKET_NAME && process.env.GOOGLE_APPLICATION_CREDENTIALS);
  const dropboxConfigured = Boolean(process.env.DROPBOX_ACCESS_TOKEN);

  res.json({
    success: true,
    connectors: [
      {
        provider: 'AWS S3',
        id: 's3',
        status: s3Configured ? 'connected' : 'unconfigured',
        description: 'Stream or import doorbell surveillance MP4s from Amazon S3 buckets.',
        requires: ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_S3_BUCKET', 'AWS_REGION']
      },
      {
        provider: 'Google Cloud Storage',
        id: 'gcs',
        status: gcsConfigured ? 'connected' : 'unconfigured',
        description: 'Read footage directly from Google Cloud Storage buckets.',
        requires: ['GOOGLE_APPLICATION_CREDENTIALS', 'GCS_BUCKET_NAME']
      },
      {
        provider: 'Dropbox',
        id: 'dropbox',
        status: dropboxConfigured ? 'connected' : 'unconfigured',
        description: 'Import shared doorbell event recordings from Dropbox folders.',
        requires: ['DROPBOX_ACCESS_TOKEN']
      }
    ]
  });
});

// POST /api/videos/upload - Direct binary stream upload for video files
router.post('/upload', (req, res) => {
  try {
    const rawFileName = req.headers['x-filename'] || `upload_${Date.now()}.mp4`;
    const cleanFileName = decodeURIComponent(rawFileName).replace(/[^a-zA-Z0-9._-]/g, '_');
    const destPath = path.join(UPLOADS_DIR, cleanFileName);
    const writeStream = fs.createWriteStream(destPath);

    req.pipe(writeStream);

    writeStream.on('finish', () => {
      const stat = fs.existsSync(destPath) ? fs.statSync(destPath) : { size: 0 };
      const stem = path.parse(cleanFileName).name;
      const relPath = path.relative(path.join(ROOT_DIR, 'clips'), destPath).replace(/\\/g, '/');

      const newVideo = {
        id: stem,
        clip_id: stem,
        file_name: cleanFileName,
        stem,
        bucket: 'uploaded',
        relative_path: relPath,
        file_size_bytes: stat.size,
        duration_sec: 15.0,
        status: 'not_analyzed',
        has_media_file: true,
        thumbnail_url: null,
        video_url: `/media/clips/${relPath}`,
        has_analysis: false,
        analysis: null,
        ground_truth: null,
        evidence_frames: [],
        has_detections: false,
        is_dataset_benchmark: false,
        title: cleanFileName.replace(/[_-]/g, ' ')
      };

      res.json({
        success: true,
        message: `Video "${cleanFileName}" uploaded and registered successfully!`,
        video: newVideo
      });
    });

    writeStream.on('error', (err) => {
      res.status(500).json({ success: false, error: `Upload stream failed: ${err.message}` });
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/videos/ingest-url - Ingest YouTube, Cloud storage, or web video stream with SSRF protection
router.post('/ingest-url', async (req, res) => {
  try {
    const { url, title } = req.body;
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ success: false, error: 'A valid URL is required.' });
    }

    // SSRF Protection: Validate protocol and block internal/private IP ranges
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch {
      return res.status(400).json({ success: false, error: 'Malformed URL provided.' });
    }

    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return res.status(400).json({ success: false, error: 'Only HTTP and HTTPS protocols are allowed.' });
    }

    const hostname = parsedUrl.hostname.toLowerCase();
    const blockedHosts = [
      'localhost',
      '127.0.0.1',
      '0.0.0.0',
      '::1',
      '169.254.169.254',
      'metadata.google.internal',
      'instance-data'
    ];
    if (
      blockedHosts.includes(hostname) ||
      hostname.endsWith('.localhost') ||
      hostname.endsWith('.local') ||
      /^10\./.test(hostname) ||
      /^192\.168\./.test(hostname) ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname)
    ) {
      return res.status(403).json({ success: false, error: 'Access to private, local, or metadata addresses is strictly forbidden.' });
    }

    const isYouTube = hostname.includes('youtube.com') || hostname.includes('youtu.be');
    const isCloudLink = hostname.includes('drive.google.com') || hostname.includes('dropbox.com') || hostname.includes('amazonaws.com') || hostname.includes('blob.core.windows.net');
    const sourceLabel = isYouTube ? 'YouTube video' : isCloudLink ? 'Cloud storage video' : 'Web video stream';

    const pythonExec = process.platform === 'win32' ? 'python' : 'python3';
    const args = [
      DOWNLOAD_SCRIPT,
      '--url', url,
      '--out-dir', UPLOADS_DIR,
      '--max-duration', '600'
    ];
    if (title && title.trim()) {
      args.push('--title', title.trim());
    }

    // Cleanly await download without premature response
    const result = await new Promise((resolve, reject) => {
      const proc = spawn(pythonExec, args, {
        cwd: ROOT_DIR,
        env: { ...process.env, PYTHONUNBUFFERED: '1' }
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (d) => { stdout += d.toString(); });
      proc.stderr.on('data', (d) => { stderr += d.toString(); });

      proc.on('error', (err) => {
        reject(new Error(`Failed to start download process: ${err.message}`));
      });

      proc.on('close', (code) => {
        if (code !== 0) {
          const errDetail = stderr.replace(/\[[^\]]+\]/g, '').trim() || 'Download process failed';
          return reject(new Error(errDetail));
        }
        try {
          // Robust JSON extraction: look for JSON line from the end of stdout
          const lines = stdout.trim().split(/\r?\n/);
          let parsedOutput = null;

          for (let i = lines.length - 1; i >= 0; i--) {
            const line = lines[i].trim();
            if (line.startsWith('{') && line.endsWith('}')) {
              try {
                parsedOutput = JSON.parse(line);
                break;
              } catch (_) {}
            }
          }

          if (!parsedOutput) {
            // Fallback: extract first valid JSON block
            const match = stdout.match(/\{[\s\S]*\}/);
            if (match) {
              parsedOutput = JSON.parse(match[0]);
            }
          }

          if (!parsedOutput) {
            throw new Error(`No JSON output received from downloader. Process output was:\n${stdout.slice(0, 300)}`);
          }

          resolve(parsedOutput);
        } catch (e) {
          reject(new Error(`Failed to parse ingestion output: ${e.message}`));
        }
      });
    });

    const relPath = path.relative(path.join(ROOT_DIR, 'clips'), result.filepath).replace(/\\/g, '/');

    const newVideo = {
      id: result.id,
      clip_id: result.id,
      file_name: result.filename,
      stem: result.id,
      bucket: 'uploaded',
      relative_path: relPath,
      file_size_bytes: fs.existsSync(result.filepath) ? fs.statSync(result.filepath).size : null,
      duration_sec: result.duration || 15.0,
      status: 'not_analyzed',
      has_media_file: true,
      thumbnail_url: result.thumbnail || null,
      video_url: `/media/clips/${relPath}`,
      has_analysis: false,
      analysis: null,
      ground_truth: null,
      evidence_frames: [],
      has_detections: false,
      is_dataset_benchmark: false,
      title: title || result.title
    };

    return res.json({
      success: true,
      message: `${sourceLabel} "${result.title}" downloaded and registered successfully!`,
      video: newVideo
    });
  } catch (err) {
    return res.status(422).json({
      success: false,
      error: `Failed to ingest video: ${err.message}`
    });
  }
});

// GET /api/videos/:id/detections - Get bounding box detection coordinates for video
router.get('/:id/detections', (req, res) => {
  try {
    const id = req.params.id;
    const detection = storageService.getDetectionForClip(id);
    if (!detection) {
      return res.status(404).json({
        success: false,
        error: `No detection coordinates found for clip ${id}`
      });
    }
    res.json({
      success: true,
      detection
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/videos/:id/ask - Per-Video RAG Q&A
router.post('/:id/ask', async (req, res) => {
  try {
    const { question, history } = req.body;
    if (!question || typeof question !== 'string') {
      return res.status(400).json({ success: false, error: 'A question is required.' });
    }

    const response = await ragService.askVideo(req.params.id, question, history || []);
    res.json({
      success: true,
      ...response
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/videos/:id - Single video metadata
router.get('/:id', (req, res) => {
  try {
    const video = videoService.getVideoById(req.params.id);
    if (!video) {
      return res.status(404).json({ success: false, error: 'Video not found' });
    }
    res.json({ success: true, video });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/videos/:id - Delete uploaded video and its evidence
router.delete('/:id', (req, res) => {
  try {
    const result = videoService.deleteVideo(req.params.id);
    res.json(result);
  } catch (err) {
    const status = err.message.includes('not found') ? 404 : 400;
    res.status(status).json({ success: false, error: err.message });
  }
});

export default router;
