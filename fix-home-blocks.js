const fs = require('fs');
let content = fs.readFileSync('server.js', 'utf8');

const startMarker = '        const blocks = [';
const endMarker = '        for (const cat of CATEGORIES) {';

const startIdx = content.indexOf(startMarker);
const endIdx = content.indexOf(endMarker);

if (startIdx === -1 || endIdx === -1) {
  console.log('Markers not found, startIdx:', startIdx, 'endIdx:', endIdx);
  process.exit(1);
}

const newBlocks = `        const blocks = [
          { type:'header', text:{ type:'plain_text', text:'WIOM IT Helpdesk', emoji:true }},

          { type:'section', text:{ type:'mrkdwn', text:
            '*' + greeting + ', ' + name + '! :wave:*\nSelect a category below or *type your problem directly in DM* - AI will help you instantly.\n_To create a ticket: type \`/ticket\`_'
          }},

          ...(emp ? [{
            type:'section', fields:[
              { type:'mrkdwn', text:'*Emp ID:* \`' + emp.empId + '\`' },
              { type:'mrkdwn', text:'*Dept:* ' + (dept||'-') },
              { type:'mrkdwn', text:'*Laptop:* ' + (laptop||'-') },
              { type:'mrkdwn', text:'*S/N:* \`' + (laptopSN||'-') + '\`' },
              { type:'mrkdwn', text: openCnt > 0
                ? '*Open Tickets:* *' + openCnt + ' open* :warning:'
                : '*Tickets:* :white_check_mark: No open tickets' }
            ]
          }] : []),

          { type:'divider' },

          ...(myTickets.length > 0 ? [
            { type:'section', text:{ type:'mrkdwn', text:
              '*Last Ticket:* ' + (statEmoji[myTickets[0].status]||':yellow_circle:') + ' \`' + myTickets[0].ticketId + '\` - ' + (myTickets[0].description||'').substring(0,50) + '...\n' +
              (priEmoji2[myTickets[0].priority]||':yellow_circle:') + ' ' + myTickets[0].priority + ' | ' + (myTickets[0].category||'Other') + ' | _' + Math.floor((Date.now()-new Date(myTickets[0].createdAt))/3600000) + 'h ago_' +
              (myTickets[0].resolution ? '\n:white_check_mark: *Resolved:* ' + myTickets[0].resolution.substring(0,60) : '')
            }}
          ] : []),

          { type:'divider' },
          { type:'section', text:{ type:'mrkdwn', text:'*Select a Category:*' }},
          { type:'context', elements:[{ type:'mrkdwn', text:'_Click a category to expand, then select your issue. Or type your problem in DM._' }]}
        ];

        `;

content = content.substring(0, startIdx) + newBlocks + content.substring(endIdx);
fs.writeFileSync('server.js', content, 'utf8');
console.log('Done. Lines:', content.split('\n').length);
