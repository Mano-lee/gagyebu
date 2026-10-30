// 가계부 동기화용 Apps Script
// 구글 시트 > 확장 프로그램 > Apps Script 에 이 코드를 통째로 붙여넣으세요.
// 아래 SECRET을 나만 아는 비밀번호로 바꾸세요. (가계부 설정 탭에 같은 값을 입력해요)
const SECRET = '여기에-비밀번호-입력';

function doGet(e) { return handle(e.parameter.key, null); }
function doPost(e) { const b = JSON.parse(e.postData.contents); return handle(b.key, b); }

function handle(key, body) {
  if (SECRET === '여기에-비밀번호-입력' || key !== SECRET) return out({ error: 'auth' });
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const cur = readData();
    if (!body) return out(cur);
    // 다른 기기가 먼저 바꿨으면 덮어쓰지 않고 알려줌
    if (!body.force && cur.ver && body.base !== cur.ver) return out({ conflict: true, ver: cur.ver, data: cur.data });
    const ver = Date.now();
    writeData(ver, body.data);
    writeList(body.data);
    return out({ ok: true, ver: ver });
  } finally {
    lock.releaseLock();
  }
}

function out(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function sheet(name) {
  const ss = SpreadsheetApp.getActive();
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

// 원본 데이터: '_data' 탭의 A1=버전, A2부터 JSON을 나눠 저장 (셀 하나에 5만 자 제한)
function readData() {
  const sh = SpreadsheetApp.getActive().getSheetByName('_data');
  if (!sh || sh.getLastRow() < 2) return { ver: 0, data: null };
  const v = sh.getRange(1, 1, sh.getLastRow(), 1).getValues().map(r => String(r[0]));
  return { ver: Number(v[0]), data: JSON.parse(v.slice(1).map(s => s.slice(1)).join('')) };
}

function writeData(ver, data) {
  const json = JSON.stringify(data), rows = [[ver]];
  // 앞에 'x'를 붙여 '=' 등으로 시작해도 수식으로 바뀌지 않게 함
  for (let i = 0; i < json.length; i += 40000) rows.push(['x' + json.slice(i, i + 40000)]);
  const sh = sheet('_data');
  sh.clearContents();
  sh.getRange(1, 1, rows.length, 1).setValues(rows);
}

// 보기용: '내역' 탭에 날짜순으로 정리
function writeList(data) {
  const names = { out: '지출', in: '수입' };
  const rows = [];
  Object.keys(data.p || {}).forEach(k => data.p[k].tx.forEach(t =>
    rows.push([t.date, names[t.type] || t.type, t.cat, t.type === 'out' ? -t.amt : t.amt, "'" + (t.memo || '')])));
  rows.sort((a, b) => a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0);
  const sh = sheet('내역');
  sh.clearContents();
  sh.getRange(1, 1, 1, 5).setValues([['날짜', '구분', '분류', '금액', '메모']]).setFontWeight('bold');
  sh.setFrozenRows(1);
  if (rows.length) {
    sh.getRange(2, 1, rows.length, 5).setValues(rows);
    sh.getRange(2, 4, rows.length, 1).setNumberFormat('#,##0');
  }
}
