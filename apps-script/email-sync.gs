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
 * 7. (Optional) Add a second trigger for nightly cleanup:
 *    - Function: cleanupOldRows
 *    - Event source: Time-driven
 *    - Type: Day timer
 *    - Time of day: 11pm to midnight
 * 8. Make sure the Sheet is shared: "Anyone with the link" > Viewer
 * 9. In the CMO Task Manager app, click "Sync Email" and paste the Sheet URL
 *
 * USAGE:
 * Forward any email from Outlook to the Gmail address.
 * The script reads unread emails, writes them to the Sheet, and marks them as read.
 * The app's "Sync Email" button pulls new rows from the Sheet.
 * Old rows are automatically cleaned up nightly (keeps last 24 hours by default).
 */

// How many hours to keep rows before cleanup deletes them (default: 24)
var KEEP_HOURS = 24;

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

/**
 * Deletes rows older than KEEP_HOURS.
 * Safe to run — the app has duplicate detection, so re-syncing
 * won't create duplicates even if new emails arrive after cleanup.
 *
 * Set up a nightly trigger for this function, or call it manually.
 */
function cleanupOldRows() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return; // nothing to clean (just headers)

  var cutoff = new Date();
  cutoff.setHours(cutoff.getHours() - KEEP_HOURS);

  // Read all date values (column D, index 3)
  var dates = sheet.getRange(2, 4, lastRow - 1, 1).getValues();

  // Work backwards to avoid shifting row indices
  var rowsDeleted = 0;
  for (var i = dates.length - 1; i >= 0; i--) {
    var dateStr = dates[i][0];
    if (!dateStr) continue;
    var rowDate = new Date(dateStr);
    if (rowDate < cutoff) {
      sheet.deleteRow(i + 2); // +2 because row 1 is headers, array is 0-indexed
      rowsDeleted++;
    }
  }

  Logger.log('Cleanup: deleted ' + rowsDeleted + ' rows older than ' + KEEP_HOURS + ' hours');
}

/**
 * Deletes ALL data rows, keeping only the header.
 * Use this if you want to manually wipe the sheet clean.
 */
function clearAllRows() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return;
  sheet.deleteRows(2, lastRow - 1);
  Logger.log('Cleared all ' + (lastRow - 1) + ' data rows');
}
