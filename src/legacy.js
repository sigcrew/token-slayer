// 이름을 바꾸기 전(Token Buddy)에 쓰던 저장소를 새 이름으로 옮긴다.
const fs = require('fs');
const path = require('path');

// claude.ai 로그인이 든 세션 저장소 폴더: Partitions/token-buddy-claude → Partitions/token-slayer-claude
// (세션을 열기 전에 실행해야 하고, 새 폴더가 이미 있으면 건드리지 않는다)
function renameClaudePartition(userDir) {
  try {
    const parts = path.join(userDir, 'Partitions');
    const from = path.join(parts, 'token-buddy-claude');
    const to = path.join(parts, 'token-slayer-claude');
    if (fs.existsSync(from) && !fs.existsSync(to)) { fs.renameSync(from, to); return true; }
  } catch {}
  return false;
}

module.exports = { renameClaudePartition };
