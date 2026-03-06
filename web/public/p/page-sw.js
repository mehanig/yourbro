// Service Worker for yourbro page asset serving.
// Caches page file bundles sent via postMessage and serves them on fetch.

var CACHE_NAME = 'yourbro-pages-v2';

self.addEventListener('install', function() {
    self.skipWaiting();
});

self.addEventListener('activate', function(event) {
    event.waitUntil(self.clients.claim());
});

// Content-Type mapping by extension
var MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js':   'application/javascript; charset=utf-8',
    '.mjs':  'application/javascript; charset=utf-8',
    '.css':  'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg':  'image/svg+xml',
    '.txt':  'text/plain; charset=utf-8',
    '.xml':  'text/xml; charset=utf-8',
    '.png':  'image/png',
    '.jpg':  'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif':  'image/gif',
    '.webp': 'image/webp',
    '.ico':  'image/x-icon',
    '.woff': 'font/woff',
    '.woff2':'font/woff2',
    '.ttf':  'font/ttf',
    '.otf':  'font/otf',
    '.mp3':  'audio/mpeg',
    '.mp4':  'video/mp4',
    '.webm': 'video/webm',
    '.pdf':  'application/pdf'
};

function getMimeType(filename) {
    var dot = filename.lastIndexOf('.');
    if (dot === -1) return 'text/plain; charset=utf-8';
    var ext = filename.substring(dot).toLowerCase();
    return MIME_TYPES[ext] || 'text/plain; charset=utf-8';
}

// Handle messages from the shell to cache page files
self.addEventListener('message', function(event) {
    if (!event.data || event.data.type !== 'cache-page') return;

    var slug = event.data.slug;
    var files = event.data.files;

    caches.open(CACHE_NAME).then(function(cache) {
        var promises = Object.keys(files).map(function(filename) {
            var url = '/p/assets/' + slug + '/' + filename;
            var contentType = getMimeType(filename);
            var content = files[filename];
            // Decode base64-encoded binary files (prefixed with "base64:" by agent)
            if (typeof content === 'string' && content.substring(0, 7) === 'base64:') {
                var b64 = content.substring(7);
                var bin = atob(b64);
                var bytes = new Uint8Array(bin.length);
                for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                content = bytes.buffer;
            }
            var response = new Response(content, {
                status: 200,
                headers: { 'Content-Type': contentType }
            });
            return cache.put(new Request(url), response);
        });
        return Promise.all(promises);
    }).then(function() {
        // Confirm caching complete via MessageChannel
        if (event.ports && event.ports[0]) {
            event.ports[0].postMessage({ type: 'cached' });
        }
    });
});

// Intercept fetch requests for /p-assets/*
self.addEventListener('fetch', function(event) {
    var url = new URL(event.request.url);
    if (!url.pathname.startsWith('/p/assets/')) return;

    event.respondWith(
        caches.open(CACHE_NAME).then(function(cache) {
            return cache.match(event.request).then(function(response) {
                if (response) return response;
                return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain' } });
            });
        })
    );
});
