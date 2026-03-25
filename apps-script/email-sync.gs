/**
 * Google Apps Script — Email-to-Sheet Sync for CMO Task Manager
 *
 * SETUP:
 * 1. Create a dedicated Gmail account (e.g., cmo-tasks-inbox@gmail.com)
 * 2. Create a new Google Sheet in that account
 * 3. Go to Extensions > Apps Script
 * 4. Replace the default code with this entire file
 * 5. Click "Run" on processEmails() once to grant permissions
 * 6. Go to Triggers (clock icon) > Add Trigger:
 *    - Function: processEmails
 *    - Event source: Time-driven
 *    - Type: Minutes timer
 *    - Interval: Every 5 minutes
 * 7. Make sure the Sheet is shared: "Anyone with the link" > Viewer
 * 8. In the CMO Task Manager app, click "Sync Email" and paste the Sheet URL
 *
 * USAGE:
 * Forward any email from Outlook to the Gmail address.
 * The script reads unread emails, writes them to the Sheet, and marks them as read.
 * The app's "Sync Email" button pulls new rows from the Sheet.
 */

function processEmails() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();

  // Add headers if the sheet is empty
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['Subject', 'From', 'Body', 'Date', 'MessageId']);
    sheet.getRange(1, 1, 1, 5).setFontWeight('bold');
  }

  // Get existing message IDs to avoid duplicates
  var existingIds = new Set();
  if (sheet.getLastRow() > 1) {
    var idRange = sheet.getRange(2, 5, sheet.getLastRow() - 1, 1).getValues();
    idRange.forEach(function(row) {
      if (row[0]) existingIds.add(row[0]);
    });
  }

  // Search for unread emails
  var threads = GmailApp.search('is:unread', 0, 50);

  threads.forEach(function(thread) {
    var messages = thread.getMessages();
    messages.forEach(function(message) {
      if (message.isUnread()) {
        var msgId = message.getId();

        // Skip if already processed
        if (existingIds.has(msgId)) {
          message.markRead();
          return;
        }

        var subject = message.getSubject() || '(no subject)';
        var from = message.getFrom() || '';
        var body = message.getPlainBody() || '';
        var date = message.getDate().toISOString();

        // Clean up forwarded email prefixes
        subject = subject.replace(/^(Fw|Fwd|FW|RE|Re):\s*/i, '');

        // Truncate body to avoid Sheet cell limits (50k chars max)
        if (body.length > 5000) {
          body = body.substring(0, 5000) + '\n\n[Truncated]';
        }

        sheet.appendRow([subject, from, body, date, msgId]);
        message.markRead();
      }
    });
  });
}
