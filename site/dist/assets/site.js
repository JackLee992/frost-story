const repo = 'JackLee992/frost-story';
const fallbackDownload = `https://github.com/${repo}/releases/latest/download/FrostStory-arm64.apk`;
const $ = id => document.getElementById(id);
const formatBytes = bytes => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
};
const cleanNotes = value => (value || '').replace(/[#*_`>\[\]]/g, '').trim().split('\n').filter(Boolean).slice(0, 3).join('\n');

async function loadRelease() {
  try {
    const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' }
    });
    if (!response.ok) throw new Error(`release ${response.status}`);
    const release = await response.json();
    const asset = Array.isArray(release.assets)
      ? release.assets.find(item => item.name === 'FrostStory-arm64.apk')
      : null;
    const version = typeof release.tag_name === 'string' ? release.tag_name : 'v0.2.0';
    $('releaseVersion').textContent = version;
    $('releaseState').textContent = `${version} 已可下载`;
    if (release.published_at) {
      $('releaseDate').textContent = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'long' }).format(new Date(release.published_at));
    }
    const notes = cleanNotes(release.body);
    if (notes) $('releaseNotes').textContent = notes;
    $('downloadLink').href = asset?.browser_download_url || fallbackDownload;
    $('downloadMeta').textContent = [version, 'ARM64', formatBytes(asset?.size)].filter(Boolean).join(' · ');
  } catch {
    $('downloadLink').href = fallbackDownload;
    $('downloadMeta').textContent = 'v0.2.0 · ARM64';
    $('releaseState').textContent = 'Android v0.2.0 已可玩';
  }
}

async function loadContentVersion() {
  try {
    const response = await fetch(`https://raw.githubusercontent.com/${repo}/main/distribution/content-manifest.json`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`content ${response.status}`);
    const manifest = await response.json();
    if (!/^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$/.test(manifest.version)) throw new Error('invalid version');
    $('contentVersion').textContent = `v${manifest.version}`;
    $('contentState').textContent = manifest.version === '0.1.0'
      ? '已内置前三章；应用启动时会检查六章更新'
      : '六章 24 节点 · 完整性校验后于下次启动安全切换';
  } catch {
    $('contentState').textContent = '暂时无法读取版本；已安装内容仍可离线游玩';
  }
}

loadRelease();
loadContentVersion();
