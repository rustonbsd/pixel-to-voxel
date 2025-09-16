# Simulations

Simulating multi camera setup via blender. `make render-lakehouse` will render all camera frames to `/sim/out/images` from the lakehouse scene. Put the scene file you want to render into `/sim/scenes/MyScene.blend`  and run manualy like this:


```sh
# Quick
make render-lakehouse
# (on mac) make render-lakehouse-mac


# Run custom scene
blender -b scenes/MyScene.blend -P export_cams.py -- --out ./out --start 1 --end 10 --step 1

# MacOs:
/Applications/Blender.app/Contents/MacOS/Blender -b scenes/MyScene.blend -P export_cams.py -- --out ./out --start 1 --end 10 --step 1

```