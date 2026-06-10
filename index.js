const TelegramBot = require('node-telegram-bot-api');
const { google } = require('googleapis');
const fs = require('fs');
const https = require('https');
const http = require('http');

const BOT_TOKEN = process.env.BOT_TOKEN;
const SHEET_ID = process.env.SHEET_ID;
const GOOGLE_CREDENTIALS = JSON.parse(process.env.GOOGLE_CREDENTIALS);
const ALLOWED_CHAT_ID = process.env.ALLOWED_CHAT_ID;

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Google Sheets auth
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

// Generate Invoice as HTML then send as text-based bill
function generateInvoiceText(invoiceData) {
  const { customerName, city, items, invoiceNo, date } = invoiceData;
  
  let total = 0;
  let itemLines = '';
  
  items.forEach(item => {
    const amount = item.qty * item.rate;
    total += amount;
    itemLines += `
│ ${item.type.padEnd(12)} │ ${String(item.qty).padStart(3)} │ ₹${String(item.rate.toLocaleString('en-IN')).padStart(8)} │ ₹${String(amount.toLocaleString('en-IN')).padStart(9)} │`;
  });

  const invoice = `
╔══════════════════════════════════════╗
║         🏪 KUBRA TRADERS             ║
║    Wholesale Branded Second-Hand     ║
║   📍 Rajkot, Gujarat                 ║
║   📞 +91 94275 65814                 ║
╠══════════════════════════════════════╣
║  INVOICE No: ${invoiceNo.padEnd(23)}║
║  Date: ${date.padEnd(29)}║
╠══════════════════════════════════════╣
║  Bill To: ${customerName.padEnd(27)}║
║  City: ${city.padEnd(29)}║
╠══════════════════════════════════════╣
│ Item         │ Qty │     Rate │    Amount │
├──────────────┼─────┼──────────┼───────────┤${itemLines}
├──────────────┴─────┴──────────┼───────────┤
│                          TOTAL │ ₹${String(total.toLocaleString('en-IN')).padStart(8)} │
╚════════════════════════════════╧═══════════╝
       🙏 Thank you for your business!
`;
  return { text: invoice, total };
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

let invoiceCounter = 1;

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

*Invoice/Bill:*
\`bill Ravi Mumbai mens 2 4500 ladies 1 3800\``, { parse_mode: 'Markdown' });
  }

  if (text.toLowerCase().startsWith('bill ')) {
    const billData = parseBill(text);
    if (!billData) {
      return bot.sendMessage(chatId, `❓ Format:\n\`bill Ravi Mumbai mens 2 4500 ladies 1 3800\``, { parse_mode: 'Markdown' });
    }
    
    const date = new Date().toLocaleDateString('en-IN');
    const invoiceNo = `KT-${String(invoiceCounter++).padStart(4, '0')}`;
    const { text: invoiceText, total } = generateInvoiceText({ ...billData, invoiceNo, date });
    
    await bot.sendMessage(chatId, `\`\`\`${invoiceText}\`\`\`\n✅ Total: ₹${total.toLocaleString('en-IN')}`, { parse_mode: 'Markdown' });
    return;
  }

  const parsed = parseMessage(text);
  if (!parsed) return bot.sendMessage(chatId, `❓ Samajh nahi aaya. /help type karo.`);

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
      for (const row of rows.slice(-10)) {
        stmt += `${row[0]} | ${row[2]} | ₹${row[3] || row[4]} | Bal: ₹${row[5]}\n`;
      }
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

// Keep alive
http.createServer((req, res) => res.end('AlKubra Hisab Bot Running')).listen(process.env.PORT || 3000);
console.log('AlKubra Hisab Bot started...');
