const TelegramBot = require('node-telegram-bot-api');
const { google } = require('googleapis');
const fs = require('fs');
const http = require('http');

const BOT_TOKEN = process.env.BOT_TOKEN;
const SHEET_ID = process.env.SHEET_ID;
const GOOGLE_CREDENTIALS = JSON.parse(process.env.GOOGLE_CREDENTIALS);
const ALLOWED_CHAT_ID = process.env.ALLOWED_CHAT_ID;

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

const auth = new google.auth.GoogleAuth({
  credentials: GOOGLE_CREDENTIALS,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

async function getSheets() {
  const client = await auth.getClient();
  return google.sheets({ version: 'v4', auth: client });
}

async function getBalance(sheets, tab, name) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${tab}!A:G`,
  });
  const rows = res.data.values || [];
  let balance = 0;
  for (const row of rows.slice(1)) {
    if (row[1] && row[1].toLowerCase() === name.toLowerCase()) {
      balance = parseFloat(row[5]) || 0;
    }
  }
  return balance;
}

async function appendRow(sheets, tab, rowData) {
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${tab}!A:G`,
    valueInputOption: 'USER_ENTERED',
    resource: { values: [rowData] },
  });
}

async function getStatement(sheets, tab, name) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${tab}!A:G`,
  });
  const rows = res.data.values || [];
  return rows.slice(1).filter(row => row[1] && row[1].toLowerCase() === name.toLowerCase());
}

// Invoice counter — stored in Google Sheet "Settings" tab
async function getNextInvoiceNo(sheets) {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Settings!A1',
    });
    const val = res.data.values?.[0]?.[0];
    const num = parseInt(val) || 0;
    const next = num + 1;
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: 'Settings!A1',
      valueInputOption: 'USER_ENTERED',
      resource: { values: [[next]] },
    });
    return `KT-${String(next).padStart(4, '0')}`;
  } catch (e) {
    return `KT-${String(Date.now()).slice(-4)}`;
  }
}

// Generate Invoice HTML
function generateInvoiceHTML(invoiceData) {
  const { customerName, city, items, invoiceNo, date } = invoiceData;
  let total = 0;
  
  const itemRows = items.map(item => {
    const amount = item.qty * item.rate;
    total += amount;
    return `
      <tr>
        <td>${item.type} Bale</td>
        <td style="text-align:center">${item.qty}</td>
        <td style="text-align:right">₹${item.rate.toLocaleString('en-IN')}</td>
        <td style="text-align:right">₹${amount.toLocaleString('en-IN')}</td>
      </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Georgia, serif; background: #FAFAF8; color: #1C1C1C; width: 600px; }
  .top-bar { height: 5px; background: #B8973A; }
  .header { padding: 28px 36px 20px; position: relative; }
  .ghost-k { position: absolute; font-size: 160px; font-weight: 700; color: rgba(184,151,58,0.07); top: -10px; left: 20px; font-family: serif; }
  .company-name { font-size: 42px; font-weight: 700; letter-spacing: 3px; color: #1C1C1C; }
  .gold-line { height: 1.5px; background: #B8973A; width: 340px; margin: 6px 0; }
  .traders { font-size: 16px; letter-spacing: 14px; color: #1C1C1C; font-weight: 400; }
  .tagline { font-size: 10px; color: #888; letter-spacing: 3px; font-family: Arial, sans-serif; margin-top: 4px; }
  .phone-row { display: flex; align-items: center; margin-top: 8px; font-family: Arial, sans-serif; font-size: 12px; color: #444; }
  .gold-dot { width: 7px; height: 7px; background: #B8973A; border-radius: 50%; margin-right: 8px; }
  .invoice-box { position: absolute; top: 28px; right: 36px; text-align: right; }
  .invoice-label { font-size: 22px; font-weight: 700; color: #B8973A; }
  .invoice-meta { font-family: Arial, sans-serif; font-size: 12px; color: #666; margin-top: 4px; }
  .divider { height: 1px; background: #ddd; margin: 0 36px; }
  .bill-to { padding: 18px 36px; }
  .bill-to-label { font-size: 11px; font-weight: 700; color: #B8973A; font-family: Arial, sans-serif; letter-spacing: 2px; }
  .bill-to-name { font-size: 20px; font-weight: 700; margin-top: 4px; }
  .bill-to-city { font-size: 13px; color: #666; font-family: Arial, sans-serif; margin-top: 2px; }
  table { width: calc(100% - 72px); margin: 0 36px; border-collapse: collapse; }
  thead tr { background: #1C1C1C; color: #FAFAF8; }
  thead td { padding: 10px 12px; font-family: Arial, sans-serif; font-size: 12px; font-weight: 700; letter-spacing: 1px; }
  tbody tr:nth-child(even) { background: #F4F2EE; }
  tbody tr:nth-child(odd) { background: #fff; }
  tbody td { padding: 12px 12px; font-size: 14px; }
  .total-box { margin: 16px 36px 0; border: 1.5px solid #B8973A; width: 200px; margin-left: auto; margin-right: 36px; padding: 10px 16px; text-align: right; }
  .total-label { font-family: Arial, sans-serif; font-size: 12px; font-weight: 700; color: #B8973A; letter-spacing: 1px; }
  .total-amount { font-size: 24px; font-weight: 700; margin-top: 4px; }
  .footer { margin-top: 24px; padding: 16px 36px; border-top: 1px solid #ddd; font-family: Arial, sans-serif; }
  .footer-thanks { font-size: 12px; color: #888; }
  .footer-info { font-size: 11px; font-weight: 700; color: #B8973A; margin-top: 4px; }
  .bottom-bar { height: 5px; background: #B8973A; margin-top: 20px; }
</style>
</head>
<body>
<div class="top-bar"></div>
<div class="header">
  <div class="ghost-k">K</div>
  <div class="company-name">KUBRA</div>
  <div class="gold-line"></div>
  <div class="traders">TRADERS</div>
  <div class="tagline">WHOLESALE &nbsp;·&nbsp; BRANDED &nbsp;·&nbsp; SECOND-HAND</div>
  <div class="phone-row"><div class="gold-dot"></div>+91 94275 65814 &nbsp;·&nbsp; Rajkot, Gujarat</div>
  <div class="invoice-box">
    <div class="invoice-label">INVOICE</div>
    <div class="invoice-meta">No: ${invoiceNo}</div>
    <div class="invoice-meta">Date: ${date}</div>
  </div>
</div>
<div class="divider"></div>
<div class="bill-to">
  <div class="bill-to-label">BILL TO</div>
  <div class="bill-to-name">${customerName}</div>
  <div class="bill-to-city">${city}</div>
</div>
<table>
  <thead>
    <tr>
      <td>ITEM</td>
      <td style="text-align:center">QTY</td>
      <td style="text-align:right">RATE</td>
      <td style="text-align:right">AMOUNT</td>
    </tr>
  </thead>
  <tbody>${itemRows}</tbody>
</table>
<div class="total-box">
  <div class="total-label">TOTAL AMOUNT</div>
  <div class="total-amount">₹${total.toLocaleString('en-IN')}</div>
</div>
<div class="footer">
  <div class="footer-thanks">🙏 Thank you for your business!</div>
  <div class="footer-info">Kubra Traders — Rajkot, Gujarat — +91 94275 65814</div>
</div>
<div class="bottom-bar"></div>
</body>
</html>`;
}

// Parse bill command
function parseBill(text) {
  const match = text.trim().match(/^bill\s+(\S+)\s+(\S+)\s+(.+)$/i);
  if (!match) return null;
  const customerName = match[1];
  const city = match[2];
  const itemsStr = match[3];
  const items = [];
  const itemRegex = /(mens|ladies|kids)\s+(\d+)\s+(\d+)/gi;
  let m;
  while ((m = itemRegex.exec(itemsStr)) !== null) {
    items.push({
      type: m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase(),
      qty: parseInt(m[2]),
      rate: parseInt(m[3])
    });
  }
  if (items.length === 0) return null;
  return { customerName, city, items };
}

function parseMessage(text) {
  const t = text.trim().toLowerCase();
  if (t.startsWith('bill ')) return { action: 'bill' };
  const balMatch = t.match(/^balance\s+(supplier|customer)\s+(.+)$/);
  if (balMatch) return { action: 'balance', tab: balMatch[1] === 'supplier' ? 'Suppliers' : 'Customers', name: balMatch[2].trim() };
  const stmtMatch = t.match(/^statement\s+(supplier|customer)\s+(.+)$/);
  if (stmtMatch) return { action: 'statement', tab: stmtMatch[1] === 'supplier' ? 'Suppliers' : 'Customers', name: stmtMatch[2].trim() };
  const supMatch = t.match(/^supplier\s+(\S+)\s+(diya|liya)\s+(\d+(?:\.\d+)?)\s*(.*)$/);
  if (supMatch) return { action: 'entry', tab: 'Suppliers', name: supMatch[1], type: supMatch[2], amount: parseFloat(supMatch[3]), note: supMatch[4] || '' };
  const cusMatch = t.match(/^customer\s+(\S+)\s+(beja|payment|aaya|mila)\s+(\d+(?:\.\d+)?)\s*(.*)$/);
  if (cusMatch) return { action: 'entry', tab: 'Customers', name: cusMatch[1], type: cusMatch[2], amount: parseFloat(cusMatch[3]), note: cusMatch[4] || '' };
  return null;
}

bot.on('message', async (msg) => {
  const chatId = msg.chat.id.toString();
  if (ALLOWED_CHAT_ID && chatId !== ALLOWED_CHAT_ID) return bot.sendMessage(chatId, '❌ Access denied.');
  const text = msg.text || '';

  if (text.toLowerCase() === '/start' || text.toLowerCase() === '/help') {
    return bot.sendMessage(chatId, `🧾 *AlKubra Hisab Bot*

*Supplier:*
\`supplier Ahmed diya 5000\`
\`supplier Ahmed liya 3000 maal\`

*Customer:*
\`customer Ravi beja 10000\`
\`customer Ravi payment 5000\`

*Balance:*
\`balance supplier Ahmed\`
\`balance customer Ravi\`

*Statement:*
\`statement supplier Ahmed\`

*Invoice:*
\`bill Ravi Mumbai mens 2 4500 ladies 1 3800\``, { parse_mode: 'Markdown' });
  }

  if (text.toLowerCase().startsWith('bill ')) {
    const billData = parseBill(text);
    if (!billData) return bot.sendMessage(chatId, '❓ Format:\n`bill Ravi Mumbai mens 2 4500 ladies 1 3800`', { parse_mode: 'Markdown' });

    try {
      await bot.sendMessage(chatId, '⏳ Invoice ban raha hai...');
      const sheets = await getSheets();
      const date = new Date().toLocaleDateString('en-IN');
      const invoiceNo = await getNextInvoiceNo(sheets);
      const html = generateInvoiceHTML({ ...billData, invoiceNo, date });

      // Try html-pdf-node
      let pdfBuffer;
      try {
        const htmlPdf = require('html-pdf-node');
        const file = { content: html };
        pdfBuffer = await htmlPdf.generatePdf(file, { format: 'A5', printBackground: true });
      } catch(e) {
        console.error('PDF error:', e.message);
        // Fallback to text bill
        let total = billData.items.reduce((s, i) => s + i.qty * i.rate, 0);
        return bot.sendMessage(chatId, `🧾 *Invoice ${invoiceNo}*\n👤 ${billData.customerName} — ${billData.city}\n📅 ${date}\n\n${billData.items.map(i => `• ${i.type} ×${i.qty} @ ₹${i.rate.toLocaleString('en-IN')} = ₹${(i.qty*i.rate).toLocaleString('en-IN')}`).join('\n')}\n\n*TOTAL: ₹${total.toLocaleString('en-IN')}*`, { parse_mode: 'Markdown' });
      }

      const filename = `/tmp/invoice_${invoiceNo}.pdf`;
      fs.writeFileSync(filename, pdfBuffer);
      await bot.sendDocument(chatId, filename, { caption: `✅ Invoice ${invoiceNo}\n👤 ${billData.customerName} — ${billData.city}` });
      fs.unlinkSync(filename);
    } catch (err) {
      console.error(err);
      bot.sendMessage(chatId, `⚠️ Error: ${err.message}`);
    }
    return;
  }

  const parsed = parseMessage(text);
  if (!parsed) return bot.sendMessage(chatId, '❓ Samajh nahi aaya. /help type karo.');

  try {
    const sheets = await getSheets();
    if (parsed.action === 'balance') {
      const bal = await getBalance(sheets, parsed.tab, parsed.name);
      const emoji = parsed.tab === 'Suppliers' ? '🏭' : '👤';
      const msg2 = bal > 0 ? `${emoji} *${parsed.name}* — ₹${bal.toLocaleString('en-IN')} baaki hai`
        : bal < 0 ? `${emoji} *${parsed.name}* — ₹${Math.abs(bal).toLocaleString('en-IN')} advance mein`
        : `${emoji} *${parsed.name}* — Saaf hai ✅`;
      return bot.sendMessage(chatId, msg2, { parse_mode: 'Markdown' });
    }
    if (parsed.action === 'statement') {
      const rows = await getStatement(sheets, parsed.tab, parsed.name);
      if (rows.length === 0) return bot.sendMessage(chatId, `📋 ${parsed.name} ki koi entry nahi mili.`);
      let stmt = `📋 *${parsed.name} ka Statement:*\n\n`;
      for (const row of rows.slice(-10)) stmt += `${row[0]} | ${row[2]} | ₹${row[3] || row[4]} | Bal: ₹${row[5]}\n`;
      return bot.sendMessage(chatId, stmt, { parse_mode: 'Markdown' });
    }
    if (parsed.action === 'entry') {
      const prevBal = await getBalance(sheets, parsed.tab, parsed.name);
      let debit = 0, credit = 0, newBal = 0;
      if (parsed.tab === 'Suppliers') {
        if (parsed.type === 'diya') { credit = parsed.amount; newBal = prevBal - parsed.amount; }
        if (parsed.type === 'liya') { debit = parsed.amount; newBal = prevBal + parsed.amount; }
      } else {
        if (parsed.type === 'beja') { debit = parsed.amount; newBal = prevBal + parsed.amount; }
        if (['payment', 'aaya', 'mila'].includes(parsed.type)) { credit = parsed.amount; newBal = prevBal - parsed.amount; }
      }
      const date = new Date().toLocaleDateString('en-IN');
      const name = parsed.name.charAt(0).toUpperCase() + parsed.name.slice(1);
      await appendRow(sheets, parsed.tab, [date, name, parsed.type, debit || '', credit || '', newBal, parsed.note]);
      const reply = `${parsed.tab === 'Suppliers' ? '🏭' : '👤'} *${name}* — Entry saved ✅\n📅 ${date}\n💸 ${parsed.type}: ₹${parsed.amount.toLocaleString('en-IN')}\n📝 ${parsed.note || '-'}\n📊 Balance: ₹${newBal.toLocaleString('en-IN')}`;
      return bot.sendMessage(chatId, reply, { parse_mode: 'Markdown' });
    }
  } catch (err) {
    console.error(err);
    bot.sendMessage(chatId, `⚠️ Error: ${err.message}`);
  }
});

http.createServer((req, res) => res.end('AlKubra Hisab Bot Running')).listen(process.env.PORT || 3000);
console.log('AlKubra Hisab Bot started...');
