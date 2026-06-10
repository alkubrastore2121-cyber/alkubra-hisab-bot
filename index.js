const TelegramBot = require('node-telegram-bot-api');
const { google } = require('googleapis');
const { createCanvas, loadImage } = require('canvas');
const fs = require('fs');
const path = require('path');

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

// Generate Invoice Image
async function generateInvoice(invoiceData) {
  const { customerName, city, items, invoiceNo, date } = invoiceData;
  
  const W = 600;
  const headerH = 160;
  const itemRowH = 44;
  const footerH = 140;
  const H = headerH + 60 + (items.length * itemRowH) + footerH;
  
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  
  // Background
  ctx.fillStyle = '#FAFAF8';
  ctx.fillRect(0, 0, W, H);
  
  // Top gold bar
  ctx.fillStyle = '#B8973A';
  ctx.fillRect(0, 0, W, 5);
  
  // Bottom gold bar
  ctx.fillStyle = '#B8973A';
  ctx.fillRect(0, H - 5, W, 5);
  
  // Ghost K watermark
  ctx.font = 'bold 200px serif';
  ctx.fillStyle = 'rgba(184, 151, 58, 0.07)';
  ctx.fillText('K', 20, 200);
  
  // Company name
  ctx.fillStyle = '#1C1C1C';
  ctx.font = 'bold 38px serif';
  ctx.fillText('KUBRA', 40, 65);
  
  // Gold line under KUBRA
  ctx.strokeStyle = '#B8973A';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(40, 75);
  ctx.lineTo(340, 75);
  ctx.stroke();
  
  // TRADERS
  ctx.fillStyle = '#1C1C1C';
  ctx.font = '400 18px serif';
  ctx.letterSpacing = '10px';
  ctx.fillText('T R A D E R S', 42, 98);
  
  // Tagline
  ctx.fillStyle = '#888';
  ctx.font = '11px Arial';
  ctx.fillText('WHOLESALE  ·  BRANDED  ·  SECOND-HAND', 40, 118);
  
  // Phone & location
  ctx.fillStyle = '#B8973A';
  ctx.beginPath();
  ctx.arc(40, 135, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#444';
  ctx.font = '12px Arial';
  ctx.fillText('+91 94275 65814  ·  Rajkot, Gujarat', 50, 139);
  
  // INVOICE label (right side)
  ctx.fillStyle = '#B8973A';
  ctx.font = 'bold 22px serif';
  ctx.textAlign = 'right';
  ctx.fillText('INVOICE', W - 40, 55);
  
  ctx.fillStyle = '#666';
  ctx.font = '12px Arial';
  ctx.fillText(`No: ${invoiceNo}`, W - 40, 76);
  ctx.fillText(`Date: ${date}`, W - 40, 94);
  ctx.textAlign = 'left';
  
  // Divider
  ctx.strokeStyle = '#ddd';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(30, 155);
  ctx.lineTo(W - 30, 155);
  ctx.stroke();
  
  // Bill To
  ctx.fillStyle = '#B8973A';
  ctx.font = 'bold 11px Arial';
  ctx.fillText('BILL TO:', 40, 178);
  ctx.fillStyle = '#1C1C1C';
  ctx.font = 'bold 17px serif';
  ctx.fillText(customerName, 40, 198);
  ctx.fillStyle = '#666';
  ctx.font = '13px Arial';
  ctx.fillText(city, 40, 216);
  
  // Table header
  const tableY = headerH + 60;
  ctx.fillStyle = '#1C1C1C';
  ctx.fillRect(30, tableY, W - 60, 36);
  
  ctx.fillStyle = '#FAFAF8';
  ctx.font = 'bold 12px Arial';
  ctx.fillText('ITEM', 50, tableY + 23);
  ctx.textAlign = 'center';
  ctx.fillText('QTY', 320, tableY + 23);
  ctx.fillText('RATE', 420, tableY + 23);
  ctx.textAlign = 'right';
  ctx.fillText('AMOUNT', W - 50, tableY + 23);
  ctx.textAlign = 'left';
  
  // Items
  let total = 0;
  items.forEach((item, i) => {
    const y = tableY + 36 + (i * itemRowH);
    const amount = item.qty * item.rate;
    total += amount;
    
    ctx.fillStyle = i % 2 === 0 ? '#fff' : '#F9F7F4';
    ctx.fillRect(30, y, W - 60, itemRowH);
    
    ctx.fillStyle = '#1C1C1C';
    ctx.font = '14px serif';
    ctx.fillText(`${item.type} Bale`, 50, y + 27);
    
    ctx.textAlign = 'center';
    ctx.font = '13px Arial';
    ctx.fillText(item.qty, 320, y + 27);
    ctx.fillText(`₹${item.rate.toLocaleString('en-IN')}`, 420, y + 27);
    ctx.textAlign = 'right';
    ctx.font = 'bold 14px Arial';
    ctx.fillText(`₹${amount.toLocaleString('en-IN')}`, W - 50, y + 27);
    ctx.textAlign = 'left';
  });
  
  // Total box
  const totalY = tableY + 36 + (items.length * itemRowH) + 12;
  
  ctx.strokeStyle = '#B8973A';
  ctx.lineWidth = 1;
  ctx.strokeRect(W - 220, totalY, 190, 50);
  
  ctx.fillStyle = '#B8973A';
  ctx.font = 'bold 13px Arial';
  ctx.textAlign = 'right';
  ctx.fillText('TOTAL AMOUNT:', W - 50, totalY + 20);
  ctx.fillStyle = '#1C1C1C';
  ctx.font = 'bold 20px serif';
  ctx.fillText(`₹${total.toLocaleString('en-IN')}`, W - 50, totalY + 44);
  ctx.textAlign = 'left';
  
  // Footer
  const footerY = H - footerH + 20;
  ctx.strokeStyle = '#ddd';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(30, footerY);
  ctx.lineTo(W - 30, footerY);
  ctx.stroke();
  
  ctx.fillStyle = '#888';
  ctx.font = '11px Arial';
  ctx.fillText('Thank you for your business!', 40, footerY + 25);
  ctx.fillStyle = '#B8973A';
  ctx.font = 'bold 11px Arial';
  ctx.fillText('Kubra Traders — Rajkot, Gujarat — +91 94275 65814', 40, footerY + 45);
  
  // Save image
  const filename = `/tmp/invoice_${Date.now()}.png`;
  const buffer = canvas.toBuffer('image/png');
  fs.writeFileSync(filename, buffer);
  return filename;
}

// Parse bill command
// Format: bill CustomerName City mens 2 4500 ladies 1 3800 kids 1 2500
function parseBill(text) {
  const t = text.trim();
  const match = t.match(/^bill\s+(\S+)\s+(\S+)\s+(.+)$/i);
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

  // Bill command
  if (text.toLowerCase().startsWith('bill ')) {
    const billData = parseBill(text);
    if (!billData) {
      return bot.sendMessage(chatId, `❓ Format sahi nahi.\nExample:\n\`bill Ravi Mumbai mens 2 4500 ladies 1 3800\``, { parse_mode: 'Markdown' });
    }
    
    try {
      await bot.sendMessage(chatId, '⏳ Invoice ban raha hai...');
      const date = new Date().toLocaleDateString('en-IN');
      const invoiceNo = `KT-${String(invoiceCounter++).padStart(4, '0')}`;
      
      const filename = await generateInvoice({ ...billData, invoiceNo, date });
      await bot.sendPhoto(chatId, filename, { caption: `✅ Invoice ready!\n👤 ${billData.customerName} — ${billData.city}\n📅 ${date}\n🧾 ${invoiceNo}` });
      fs.unlinkSync(filename);
    } catch (err) {
      console.error(err);
      bot.sendMessage(chatId, `⚠️ Error: ${err.message}`);
    }
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
const http = require('http');
http.createServer((req, res) => res.end('AlKubra Hisab Bot Running')).listen(process.env.PORT || 3000);
console.log('AlKubra Hisab Bot started...');
