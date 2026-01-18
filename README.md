# n8n-nodes-ainoflow

n8n community nodes for [Ainoflow](https://ainoflow.io) API services.

## Nodes

| Node | Description |
|------|-------------|
| **Ainoflow Convert** | Convert documents, images, and audio to text using OCR and transcription |
| **Ainoflow Files** | Store and manage binary files in object storage |
| **Ainoflow Storage** | Store and retrieve JSON documents in key-value storage |

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation.

```bash
npm install @ainoflow/n8n-nodes-ainoflow
```

## Credentials

All nodes use the shared **Ainoflow API** credential:

| Field | Description |
|-------|-------------|
| API Key | Your Ainoflow API key |
| Base URL | API endpoint (default: `https://api.ainoflow.io`) |

## Ainoflow Convert

Convert documents, images, and audio files to text.

### Operations

| Operation | Description |
|-----------|-------------|
| **Convert Document** | Convert document, image, or audio to text |
| **Get Result** | Get result of conversion job |

### Input Sources

- **Binary Data** - File from previous node
- **URL** - Download from URL

### Response Modes

| Mode | Behavior |
|------|----------|
| Direct | Wait and return content inline |
| Persisted | Wait and return download URLs |
| Polling | Return job ID immediately |
| Webhook | Notify webhook URL when complete |

### Models

| Model | Use Case |
|-------|----------|
| Auto | Auto-select based on file type (recommended) |
| PaddleOCR | OCR for images |
| Tesseract | OCR for PDFs |
| Whisper (tiny/small/base) | Audio transcription |

### Supported Formats

- **Documents:** PDF, JPEG, PNG, TIFF, BMP, WebP, GIF, DOC(X), XLS(X), PPT(X), ODT, TXT, RTF
- **Audio:** WAV, MP3, M4A, MP4, WebM, OGG, FLAC, AAC, Opus

### Languages

60 languages supported including: English, German, French, Spanish, Italian, Portuguese, Dutch, Polish, Russian, Ukrainian, Chinese (Simplified/Traditional), Japanese, Korean, Arabic, and more.

## Ainoflow Files

Manage binary files in object storage.

### Resources & Operations

**File:**
| Operation | Description |
|-----------|-------------|
| Create | Upload new file (auto-generated key) |
| Create or Replace | Upload file with explicit key (upsert) |
| Download | Download file content |
| Delete | Delete file |
| Get URL | Get pre-signed download URL |
| Get Metadata | Get file metadata |
| Get Many | List files in category |

**Category:**
| Operation | Description |
|-----------|-------------|
| Get Many | List categories with file counts |

### Input Sources (Create/Replace)

- **Binary Data** - File from previous node
- **URL** - Server downloads from URL

### Features

- Categories for organizing files
- Pre-signed URLs with configurable expiry
- TTL support via `expiresAt`
- Max file size: 100MB

## Ainoflow Storage

Store and retrieve JSON documents.

### Resources & Operations

**Record:**
| Operation | Description |
|-----------|-------------|
| Create | Create new record (fails if exists) |
| Create or Replace | Create or replace record (upsert) |
| Update | Partial update via JSON Merge Patch (RFC 7386) |
| Get | Retrieve record by key |
| Delete | Delete record |
| Get Metadata | Get record metadata without content |
| Get Many | List records in category |

**Category:**
| Operation | Description |
|-----------|-------------|
| Get Many | List categories with record counts |

### Data Input

- **Using Fields Below** - Key/value pairs with expression support
- **Using JSON** - Direct JSON object or array

### Features

- Categories for organizing records
- TTL support via `expiresAt` or `expiresMs`
- JSON Merge Patch for partial updates
- Max record size: 10MB

## Development

### Prerequisites

- Node.js v20.19+ to v24 (v22 LTS recommended)
- npm

### Commands

```bash
npm install        # Install dependencies
npm run dev        # Run n8n with hot reload
npm run build      # Production build
npm run lint       # Check for issues
npm run lint:fix   # Auto-fix issues
```

## Resources

- [Ainoflow Platform](https://ainoflow.io) - Document conversion, file storage, and JSON storage APIs
- [Ainova Systems](https://www.ainovasystems.com/) - Custom n8n nodes, workflow development, and AI automation solutions
- [GitHub Repository](https://github.com/ainova-systems/n8n-nodes-ainoflow)
- [n8n Community Nodes](https://docs.n8n.io/integrations/community-nodes/)

## License

[MIT](LICENSE.md) - Copyright 2026 Ainova Systems
