# Public Assets

This folder is for storing public static assets like logos and notification sounds.

## Structure

- **`logos/`** - Place your logo files here (PNG, SVG, JPG, etc.)
- **`sounds/`** - Place your notification sound files here (MP3, WAV, OGG, etc.)

## Access URLs

Once files are added to this folder, they can be accessed via:

```
https://afrikskill-hash.onrender.com/public/logos/your-logo.png
https://afrikskill-hash.onrender.com/public/sounds/notification.mp3
```

## Example Usage in Frontend

```javascript
// Logo
<img src="https://afrikskill-hash.onrender.com/public/logos/logo.png" alt="Logo" />

// Notification Sound
const audio = new Audio('https://afrikskill-hash.onrender.com/public/sounds/notification.mp3');
audio.play();
```

## How to Add Files

1. Drag and drop your files directly into the `logos/` or `sounds/` subdirectories
2. Refresh your application
3. Access the files using the URLs above

## Supported File Types

### Logos
- PNG (recommended for transparency)
- SVG (scalable vector)
- JPG/JPEG
- WebP

### Sounds
- MP3 (widely supported)
- WAV (high quality)
- OGG (open format)
- M4A (Apple format)
