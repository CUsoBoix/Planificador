-- Remaining formats; all uploads still require the validating Edge Function.
update storage.buckets
set allowed_mime_types = array(select distinct unnest(allowed_mime_types || array['application/zip','application/vnd.ms-excel.sheet.binary.macroEnabled.12','image/webp']))
where id='planner-files';
