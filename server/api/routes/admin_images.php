<?php
/**
 * Image uploads — replaces the browser IndexedDB store.
 *
 * The React side already downscales before sending, which is worth keeping:
 * it happens before the bytes leave the device, so a 12MP phone photo does not
 * crawl up a shop's uplink. This endpoint still validates independently,
 * because the client doing the right thing is not a guarantee.
 */

declare(strict_types=1);

const MAX_UPLOAD_BYTES = 6 * 1024 * 1024;

const ALLOWED_IMAGE_TYPES = [
    IMAGETYPE_JPEG => ['ext' => 'jpg',  'mime' => 'image/jpeg'],
    IMAGETYPE_PNG  => ['ext' => 'png',  'mime' => 'image/png'],
    IMAGETYPE_WEBP => ['ext' => 'webp', 'mime' => 'image/webp'],
];

function admin_upload_image(): void
{
    $user = current_user();

    if (!isset($_FILES['file'])) {
        fail('no_file', 'No file was uploaded.', 422);
    }

    $file = $_FILES['file'];

    if (($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
        $message = match ($file['error']) {
            UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE => 'That image is too large.',
            UPLOAD_ERR_PARTIAL                        => 'The upload did not finish. Please try again.',
            UPLOAD_ERR_NO_TMP_DIR, UPLOAD_ERR_CANT_WRITE => 'The server could not save the file.',
            default                                   => 'The upload failed.',
        };
        fail('upload_failed', $message, 422);
    }

    // Confirms the file really came through PHP's upload handler and is not an
    // arbitrary server path someone talked us into reading.
    if (!is_uploaded_file($file['tmp_name'])) {
        fail('upload_failed', 'The upload could not be verified.', 400);
    }

    if ($file['size'] > MAX_UPLOAD_BYTES) {
        fail('file_too_large', 'Images must be 6MB or smaller.', 422);
    }

    // Type comes from inspecting the bytes, never from the filename or the
    // client's Content-Type — both are trivially forged, and a .jpg that is
    // really a .php is the classic way to get code execution on shared hosting.
    $info = @getimagesize($file['tmp_name']);
    if ($info === false || !isset(ALLOWED_IMAGE_TYPES[$info[2]])) {
        fail('unsupported_type', 'Please upload a JPEG, PNG or WebP image.', 422);
    }

    $type   = ALLOWED_IMAGE_TYPES[$info[2]];
    $width  = (int) $info[0];
    $height = (int) $info[1];

    if ($width < 1 || $height < 1 || $width > 8000 || $height > 8000) {
        fail('bad_dimensions', 'That image\'s dimensions are out of range.', 422);
    }

    $uploadsPath = (string) config('uploads_path');
    if ($uploadsPath === '') {
        throw new RuntimeException('uploads_path is not configured.');
    }
    if (!is_dir($uploadsPath) && !@mkdir($uploadsPath, 0755, true)) {
        throw new RuntimeException("Uploads directory {$uploadsPath} could not be created.");
    }
    if (!is_writable($uploadsPath)) {
        throw new RuntimeException("Uploads directory {$uploadsPath} is not writable.");
    }

    // The id is server-generated. Accepting a client-supplied name is how you
    // get '../../index.php' written into your web root.
    $id       = 'img_' . bin2hex(random_bytes(8));
    $filename = $id . '.' . $type['ext'];
    $target   = rtrim($uploadsPath, '/\\') . DIRECTORY_SEPARATOR . $filename;

    if (!move_uploaded_file($file['tmp_name'], $target)) {
        throw new RuntimeException('Could not move the uploaded file into place.');
    }

    @chmod($target, 0644);

    db_run(
        'INSERT INTO images (id, filename, mime, width, height, size_bytes, uploaded_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)',
        [$id, $filename, $type['mime'], $width, $height, (int) $file['size'], $user['id'] ?? null]
    );

    json_response([
        'id'     => $id,
        'url'    => rtrim((string) config('uploads_url', '/uploads'), '/') . '/' . $filename,
        'width'  => $width,
        'height' => $height,
    ], 201);
}

/**
 * Delete an image and its file.
 *
 * Refuses while anything still points at it. The FKs are ON DELETE SET NULL,
 * so a delete would otherwise succeed and silently blank a menu photo.
 */
function admin_delete_image(string $id): void
{
    $image = db_one('SELECT id, filename FROM images WHERE id = ?', [$id]);
    if (!$image) {
        fail('not_found', 'No such image.', 404);
    }

    // Positional placeholders with the id repeated, not one named `:id` reused
    // four times: with emulated prepares off, MySQL binds each marker once and
    // a reused name is rejected outright.
    $uses = (int) (db_one(
        'SELECT
            (SELECT COUNT(*) FROM items      WHERE image_id = ?)
          + (SELECT COUNT(*) FROM categories WHERE image_id = ?)
          + (SELECT COUNT(*) FROM banners    WHERE image_id = ? OR background_image_id = ?)
          AS n',
        [$id, $id, $id, $id]
    )['n'] ?? 0);

    if ($uses > 0 && !need_bool($_GET, 'force', false)) {
        fail('image_in_use', "That image is still used in {$uses} place(s).", 409, ['count' => $uses]);
    }

    $path = rtrim((string) config('uploads_path'), '/\\') . DIRECTORY_SEPARATOR . $image['filename'];
    if (is_file($path)) {
        @unlink($path);
    }

    db_run('DELETE FROM images WHERE id = ?', [$id]);
    json_response(['ok' => true]);
}
