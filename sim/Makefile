
.PHONY: render-lakehouse-mac
render-lakehouse-mac:
	@/Applications/Blender.app/Contents/MacOS/Blender -b scenes/lakehouse.blend -P export_cams.py -- --out ./out --start 1 --end 10 --step 1

.PHONY: render-lakehouse
render-lakehouse:
	@blender -b scenes/lakehouse.blend -P export_cams.py -- --out ./out --start 1 --end 10 --step 1