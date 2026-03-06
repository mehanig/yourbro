// Service Worker for yourbro page asset serving.
// Caches page file bundles sent via postMessage and serves them on fetch.

var CACHE_NAME = 'yourbro-pages-v1';

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
    '.xml':  'text/xml; charset=utf-8'
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
            var response = new Response(files[filename], {
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
