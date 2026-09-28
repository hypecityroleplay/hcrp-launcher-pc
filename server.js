const http = require('http');
const url = require('url');
const ipsAutorizados = new Set();
const tokensValidos = new Map(); 
const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  if (req.method === 'POST' && parsedUrl.pathname === '/autorizar') {
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        let ip = data.ip;
        if (ip === '::1') ip = '127.0.0.1';
        if (ip) {
          ipsAutorizados.add(ip);
          setTimeout(() => ipsAutorizados.delete(ip), 60000); // 60 segundos
        }
      } catch (e) {}
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    });
  }
  else if (req.method === 'POST' && parsedUrl.pathname === '/registrar-token') {
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const { token, nickname, ip } = data;
        if (token && nickname) {
          tokensValidos.set(token, {
            nickname: nickname,
            ip: ip || null,
            expira: Date.now() + 60000 
          });
          setTimeout(() => {
            tokensValidos.delete(token);
          }, 60000);
        }
      } catch (e) {}
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    });
  }
  else if (req.method === 'GET' && parsedUrl.pathname === '/verificar') {
    let ip = parsedUrl.query.ip;
    if (ip === '::1') ip = '127.0.0.1';
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(ip && ipsAutorizados.has(ip) ? '1' : '0');
  }
  else if (req.method === 'GET' && parsedUrl.pathname === '/verificar-token') {
    const token = parsedUrl.query.token;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (!token || !tokensValidos.has(token)) {
      return res.end(JSON.stringify({ valid: false }));
    }
    const info = tokensValidos.get(token);
    if (Date.now() > info.expira) {
      tokensValidos.delete(token);
      return res.end(JSON.stringify({ valid: false }));
    }
    tokensValidos.delete(token);
    res.end(JSON.stringify({
      valid: true,
      nickname: info.nickname,
      ip: info.ip
    }));
  }
  else 
    {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
});
server.on('error', (error) => {
  if (error && error.code === 'EADDRINUSE') {
    console.warn('HCRP Auth Server: porta 3000 já está em uso.');
    return;
  }

  console.error('HCRP Auth Server:', error);
});

server.listen(3000, '127.0.0.1', () => {
  console.log('HCRP Auth Server rodando em http://127.0.0.1:3000');
});

module.exports = server;