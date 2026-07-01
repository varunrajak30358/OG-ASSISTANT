from PIL import Image, ImageDraw

def generate_core_image():
    # Image size and background
    size = (512, 512)
    img = Image.new('RGB', size, color=(10, 10, 20)) # Dark blue background
    draw = ImageDraw.Draw(img)

    # Simple futuristic core (glowing orb)
    center = (size[0] // 2, size[1] // 2)
    radius = 150
    
    # Draw glow layers
    for i in range(20, 0, -1):
        alpha = int(255 * (i / 20))
        glow_radius = radius + (i * 5)
        draw.ellipse((center[0] - glow_radius, center[1] - glow_radius, 
                      center[0] + glow_radius, center[1] + glow_radius), 
                     fill=(0, 255, 255, alpha)) # Cyan glow

    # Draw core orb
    draw.ellipse((center[0] - radius, center[1] - radius, 
                   center[0] + radius, center[1] + radius), 
                  fill=(20, 20, 40)) # Dark inner core

    # Save to desktop
    import os
    desktop = os.path.join(os.path.expanduser("~"), "Desktop")
    img_path = os.path.join(desktop, "generated_core.png")
    img.save(img_path)
    print(f"Generated image saved to: {img_path}")

generate_core_image()
