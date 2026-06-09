const TelegramBot = require('node-telegram-bot-api');
const { google } = require('googleapis');

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

// Get last balance for a name from a sheet tab
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

// Append a row to sheet
async function appendRow(sheets, tab, rowData) {
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${tab}!A:G`,
    valueInputOption: 'USER_ENTERED',
    resource: { values: [rowData] },
  });
}

// Get all entries for a name
async function getStatement(sheets, tab, name) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${tab}!A:G`,
  });
  const rows = res.data.values || [];
  return rows.slice(1).filter(row => row[1] && row[1].toLowerCase() === name.toLowerCase());
}

// Parse message
// Formats:
// supplier Ahmed diya 5000 maal ke liye
// supplier Ahmed liya 3000 
// customer Ravi beja 10000 bales
// customer Ravi payment 5000
// balance supplier Ahmed
// balance customer Ravi
// statement supplier Ahmed

function parseMessage(text) {
  const t = text.trim().toLowerCase();
  
  // balance check
  const balMatch = t.match(/^balance\s+(supplier|customer)\s+(.+)$/);
  if (balMatch) return { action: 'balance', tab: balMatch[1] === 'supplier' ? 'Suppliers' : 'Customers', name: balMatch[2].trim() };

  // statement
  const stmtMatch = t.match(/^statement\s+(supplier|customer)\s+(.+)$/);
  if (stmtMatch) return { action: 'statement', tab: stmtMatch[1] === 'supplier' ? 'Suppliers' : 'Customers', name: stmtMatch[2].trim() };

  // supplier entry: supplier [name] diya/liya [amount] [note]
  const supMatch = t.match(/^supplier\s+(\S+)\s+(diya|liya)\s+(\d+(?:\.\d+)?)\s*(.*)$/);
  if (supMatch) {
    return {
      action: 'entry',
      tab: 'Suppliers',
      name: supMatch[1],
      type: supMatch[2],
      amount: parseFloat(supMatch[3]),
      note: supMatch[4] || ''
    };
  }

  // customer entry: customer [name] beja/payment/aaya [amount] [note]
  const cusMatch = t.match(/^customer\s+(\S+)\s+(beja|payment|aaya|mila)\s+(\d+(?:\.\d+)?)\s*(.*)$/);
  if (cusMatch) {
    return {
      action: 'entry',
      tab: 'Customers',
      name: cusMatch[1],
      type: cusMatch[2],
      amount: parseFloat(cusMatch[3]),
      note: cusMatch[4] || ''
    };
  }

  return null;
}

bot.on('message', async (msg) => {
  const chatId = msg.chat.id.toString();
  
  // Security check
  if (ALLOWED_CHAT_ID && chatId !== ALLOWED_CHAT_ID) {
    return bot.sendMessage(chatId, '❌ Access denied.');
  }

  const text = msg.text || '';
  
  // Help message
  if (text.toLowerCase() === '/start' || text.toLowerCase() === '/help') {
    return bot.sendMessage(chatId, `🧾 *AlKubra Hisab Bot*

*Supplier Commands:*
\`supplier Ahmed diya 5000\` — Ahmed ko 5000 diye
\`supplier Ahmed liya 3000 maal\` — Ahmed se 3000 ka maal liya

*Customer Commands:*
\`customer Ravi beja 10000\` — Ravi ko maal beja
\`customer Ravi payment 5000\` — Ravi ne payment di

*Balance Check:*
\`balance supplier Ahmed\`
\`balance customer Ravi\`

*Statement:*
\`statement supplier Ahmed\`
\`statement customer Ravi\``, { parse_mode: 'Markdown' });
  }

  const parsed = parseMessage(text);
  
  if (!parsed) {
    return bot.sendMessage(chatId, `❓ Samajh nahi aaya. /help type karo.`);
  }

  try {
    const sheets = await getSheets();

    if (parsed.action === 'balance') {
      const bal = await getBalance(sheets, parsed.tab, parsed.name);
      const emoji = parsed.tab === 'Suppliers' ? '🏭' : '👤';
      const msg2 = bal > 0 
        ? `${emoji} *${parsed.name}* ka balance:\n💰 ₹${bal.toLocaleString('en-IN')} baaki hai`
        : bal < 0
        ? `${emoji} *${parsed.name}* ka balance:\n✅ ₹${Math.abs(bal).toLocaleString('en-IN')} advance mein hai`
        : `${emoji} *${parsed.name}* ka balance:\n✅ Saaf hai — kuch baaki nahi`;
      return bot.sendMessage(chatId, msg2, { parse_mode: 'Markdown' });
    }

    if (parsed.action === 'statement') {
      const rows = await getStatement(sheets, parsed.tab, parsed.name);
      if (rows.length === 0) return bot.sendMessage(chatId, `📋 ${parsed.name} ki koi entry nahi mili.`);
      
      let stmt = `📋 *${parsed.name} ka Statement:*\n\n`;
      for (const row of rows.slice(-10)) { // last 10 entries
        stmt += `${row[0]} | ${row[2]} | ₹${row[3]} | Bal: ₹${row[5]}\n`;
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

      const emoji = parsed.tab === 'Suppliers' ? '🏭' : '👤';
      const reply = `${emoji} *${name}* — Entry saved ✅
📅 ${date}
💸 ${parsed.type}: ₹${parsed.amount.toLocaleString('en-IN')}
📝 Note: ${parsed.note || '-'}
📊 New Balance: ₹${newBal.toLocaleString('en-IN')}`;

      return bot.sendMessage(chatId, reply, { parse_mode: 'Markdown' });
    }

  } catch (err) {
    console.error(err);
    bot.sendMessage(chatId, `⚠️ Error: ${err.message}`);
  }
});

console.log('AlKubra Hisab Bot started...');

// Keep alive HTTP server for Render
const http = require('http');
http.createServer((req, res) => res.end('AlKubra Hisab Bot Running')).listen(process.env.PORT || 3000);
console.log('HTTP server started on port', process.env.PORT || 3000);
