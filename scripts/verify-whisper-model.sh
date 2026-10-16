#!/usr/bin/env bash
# Verify every Whisper model object in R2 against its original ETag and size.
#
# WHY A SEPARATE SCRIPT
# While testing scripts/set-whisper-model-cache.mjs, a test whose `fetch` was
# mocked returned an 11-byte body that was really uploaded, overwriting
# config.json and the 29 MB decoder with the string "model-bytes". Twice I then
# checked only the object I suspected and declared R2 clean while the OTHER one
# was still corrupt. Corruption here is silent — nothing 500s, the app just
# fails to load the model — so the check must cover every file, by default.
#
# The ETags below are the MD5s of the pristine objects as first published, so a
# match proves the bytes are unchanged. `Cache-Control` is asserted separately
# because that is the thing the stamper is allowed to change.
#
# Usage:  bash scripts/verify-whisper-model.sh
set -u

BASE="https://r2.ultrafastfluency.com/whisper/onnx-community/whisper-tiny.en"
WANT_CC="${1:-public, max-age=31536000}"

# file|expected-bytes|expected-etag-md5
FILES='config.json|2197|5d010bbdc3a4cad4b1c37346478e4372
generation_config.json|1646|593cb38a6c9974760d8b031b0e8ddb51
preprocessor_config.json|339|15d1d7ee1cc6801b71f8ab68966aed86
tokenizer.json|2405679|dc7327fa1c4452c3f589e5d7d4a8eddc
tokenizer_config.json|282662|5326de036da6af716e15559a06544365
onnx/encoder_model_quantized.onnx|10124993|cd069c70a26af22c862b58cf55c3b56b
onnx/decoder_model_merged_quantized.onnx|30718858|4ba556edd13daa9949aa38b8f7d7517f'

fail=0
checked=0
while IFS='|' read -r file bytes etag; do
    [ -z "$file" ] && continue
    headers=$(curl -sI --max-time 20 "$BASE/$file" | tr -d '\r')
    got_len=$(echo "$headers" | awk 'tolower($1)=="content-length:"{print $2}')
    got_etag=$(echo "$headers" | awk 'tolower($1)=="etag:"{gsub(/"/,"",$2); print $2}')
    got_cc=$(echo "$headers" | awk 'tolower($1)=="cache-control:"{sub(/^[^ ]+ +/,""); print}')
    checked=$((checked + 1))

    status="OK  "
    if [ "$got_len" != "$bytes" ] || [ "$got_etag" != "$etag" ]; then
        status="BAD "
        fail=$((fail + 1))
    fi
    if [ "$got_cc" != "$WANT_CC" ]; then
        status="${status}CC "
        fail=$((fail + 1))
    fi
    printf '  %s %-42s %-10s cc=%s\n' "$status" "$file" "${got_len:-?}" "${got_cc:-(none)}"
done <<EOF
$FILES
EOF

echo
if [ "$fail" -eq 0 ]; then
    echo "All $checked objects match their original bytes and carry '$WANT_CC'."
else
    echo "!!! $fail problem(s) across $checked object(s) — restore from a verified copy:"
    echo "    wrangler r2 object put uff/whisper/onnx-community/whisper-tiny.en/<file> --file <copy> --cache-control '$WANT_CC'"
fi
exit $fail