<?php
// =====================================================================
// TEMP DIAGNOSTIC for api/bot_api.php  (website repo: psobb.io-website-public)
// ---------------------------------------------------------------------
// PURPOSE: get_player returns an opaque HTTP 500 for OFFLINE players, with an
// empty body (PHP display_errors is off), so the real cause is invisible to the
// Discord bot. This block turns any fatal error or uncaught exception into a
// JSON 500 body containing the actual message + file + line. The bot's apiCall()
// already logs the response body on a 5xx, so the real error will then appear in
// the Discord `!log` output — no SSH / log-diving needed.
//
// HOW TO INSTALL:
//   1. Open  api/bot_api.php  on the WEBSITE server's checkout.
//   2. Paste the marked block below IMMEDIATELY AFTER the opening `<?php` line
//      (it must run before any other code so it can catch errors anywhere).
//   3. `php -l api/bot_api.php`  to confirm no syntax error, then deploy.
//   4. Run `!sync` while OFFLINE, then `!log` — you'll see a line like:
//        [ERROR] [API] get_player [500] → ... — {"error":"PHP fatal",
//          "message":"Call to undefined function mb_convert_encoding()", ...}
//   5. Fix the root cause, then REMOVE this block (it is for diagnosis only).
//
// NOTE: register_shutdown_function is what catches *fatals* (undefined function,
// out-of-memory, type errors) that a normal try/catch / set_exception_handler
// would miss — which is exactly the class of error an empty 500 implies.
// =====================================================================

// ----- BEGIN bot_api diagnostic (paste right after <?php) -----
ini_set('display_errors', '0'); // we emit our own JSON; don't leak an HTML error page
register_shutdown_function(function () {
    $err = error_get_last();
    $fatalTypes = [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR];
    if ($err && in_array($err['type'], $fatalTypes, true)) {
        if (!headers_sent()) {
            http_response_code(500);
            header('Content-Type: application/json');
        }
        echo json_encode([
            'error'   => 'PHP fatal',
            'message' => $err['message'],
            'file'    => $err['file'],
            'line'    => $err['line'],
        ]);
    }
});
set_exception_handler(function ($e) {
    if (!headers_sent()) {
        http_response_code(500);
        header('Content-Type: application/json');
    }
    echo json_encode([
        'error'   => 'PHP exception',
        'message' => $e->getMessage(),
        'file'    => $e->getFile(),
        'line'    => $e->getLine(),
    ]);
});
// ----- END bot_api diagnostic -----
