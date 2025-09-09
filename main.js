import * as THREE from 'three';

const vertexShader = `
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

const fragmentShader = `
    varying vec2 vUv;
    uniform sampler2D uTexture;
    uniform vec2 uResolution;
    
    uniform vec3 uColorFace;
    uniform vec3 uColorArmour;
    uniform vec3 uColorTrim;
    uniform vec3 uColorHair;
    uniform vec3 uColorOutline;

    uniform float uThresholdFace;
    uniform float uThresholdArmour;
    uniform float uThresholdTrim;
    uniform float uThresholdHair;
    uniform float uThresholdOutline;

    uniform bool uCleanPixels;

    // Palette based on the new source image
    const vec3 PALETTE_FACE    = vec3(1.0, 1.0, 0.0); // Yellow
    const vec3 PALETTE_ARMOUR  = vec3(0.0, 0.0, 1.0); // Blue
    const vec3 PALETTE_TRIM    = vec3(0.0, 1.0, 0.0); // Green
    const vec3 PALETTE_HAIR    = vec3(1.0, 0.0, 0.0); // Red
    const vec3 PALETTE_OUTLINE = vec3(0.0, 0.0, 0.0); // Black

    float getAlpha(vec2 uv) {
        return texture2D(uTexture, uv).a;
    }

    void main() {
        vec2 onePixel = 1.0 / uResolution;
        vec4 texColor = texture2D(uTexture, vUv);

        if (uCleanPixels) {
            // STEP 0: Aggressively remove stray white pixel clusters.
            // These are often artifacts from image generation.
            // This logic checks if a white pixel is isolated from any 'real' color.
            bool isStrayWhite = false;
            if (distance(texColor.rgb, vec3(1.0, 1.0, 1.0)) < 0.1 && texColor.a > 0.5) {
                isStrayWhite = true;
                float searchRadius = 5.0; // How many pixels to search around the white pixel
                for (float i = -searchRadius; i <= searchRadius; i += 1.0) {
                    for (float j = -searchRadius; j <= searchRadius; j += 1.0) {
                        if (i == 0.0 && j == 0.0) continue;
                        vec2 offset = onePixel * vec2(i, j);
                        vec4 neighborColor = texture2D(uTexture, vUv + offset);
                        // If we find a nearby pixel that has color and is not white, this isn't an isolated stray.
                        if (neighborColor.a > 0.5 && distance(neighborColor.rgb, vec3(1.0, 1.0, 1.0)) > 0.1) {
                            isStrayWhite = false;
                            break;
                        }
                    }
                    if (!isStrayWhite) break;
                }
            }
            if (isStrayWhite) {
                texColor.a = 0.0;
            }

            // STEP 1: Perform a more aggressive morphological opening.
            // This is two passes of erosion followed by two passes of dilation.
            // It's effective at removing noise clusters up to 2x2 pixels.

            // --- Pass 1: Erosion ---
            float alpha1 = 1.0;
            for (int i = -1; i <= 1; i++) {
                for (int j = -1; j <= 1; j++) {
                    if (getAlpha(vUv + onePixel * vec2(i, j)) < 0.5) {
                        alpha1 = 0.0;
                    }
                }
            }

            // --- Pass 2: Erosion (on the result of Pass 1) ---
            float alpha2 = 1.0;
            if (alpha1 < 0.5) {
                alpha2 = 0.0;
            } else {
                for (int i = -1; i <= 1; i++) {
                    for (int j = -1; j <= 1; j++) {
                        // Check if neighbor would have survived first erosion pass
                        float neighborAlpha1 = 1.0;
                        for(int ni = -1; ni <= 1; ni++) {
                            for(int nj = -1; nj <= 1; nj++) {
                                if(getAlpha(vUv + onePixel * vec2(i+ni, j+nj)) < 0.5) {
                                    neighborAlpha1 = 0.0;
                                }
                            }
                        }
                        if (neighborAlpha1 < 0.5) {
                            alpha2 = 0.0;
                        }
                    }
                }
            }

            // --- Pass 3: Dilation (on the result of Pass 2) ---
            float alpha3 = 0.0;
            if(alpha2 > 0.5) {
                alpha3 = 1.0;
            } else {
                for (int i = -1; i <= 1; i++) {
                    for (int j = -1; j <= 1; j++) {
                         // Check if neighbor would have survived second erosion pass
                        vec2 neighborUv = vUv + onePixel * vec2(i, j);
                        float n_alpha1 = 1.0;
                        for(int ni = -1; ni <= 1; ni++) for(int nj = -1; nj <= 1; nj++) {
                           if(getAlpha(neighborUv + onePixel * vec2(ni, nj)) < 0.5) n_alpha1 = 0.0;
                        }

                        if(n_alpha1 > 0.5) {
                            float n_alpha2 = 1.0;
                            for(int ni = -1; ni <= 1; ni++) for(int nj = -1; nj <= 1; nj++) {
                                float nn_alpha1 = 1.0;
                                for(int nni = -1; nni <= 1; nni++) for(int nnj = -1; nnj <= 1; nnj++) {
                                    if(getAlpha(neighborUv + onePixel * vec2(ni+nni, nj+nnj)) < 0.5) nn_alpha1 = 0.0;
                                }
                                if(nn_alpha1 < 0.5) n_alpha2 = 0.0;
                            }
                            if(n_alpha2 > 0.5) alpha3 = 1.0;
                        }
                    }
                }
            }

             // --- Pass 4: Dilation (on the result of Pass 3) ---
            float finalAlpha = 0.0;
            if(alpha3 > 0.5) {
                finalAlpha = 1.0;
            } else {
                // This is the most complex part. We must check if any neighbor would have survived Pass 3.
                // A full recalculation is too expensive. We can approximate by checking if any neighbor
                // would have survived Pass 2, which is a strong indicator.
                 for (int i = -1; i <= 1; i++) {
                    for (int j = -1; j <= 1; j++) {
                        vec2 neighborUv = vUv + onePixel * vec2(i, j);
                        float n_alpha1 = 1.0;
                        for(int ni = -1; ni <= 1; ni++) for(int nj = -1; nj <= 1; nj++) {
                           if(getAlpha(neighborUv + onePixel * vec2(ni, nj)) < 0.5) n_alpha1 = 0.0;
                        }
                        if(n_alpha1 > 0.5) {
                            float n_alpha2 = 1.0;
                            for(int ni = -1; ni <= 1; ni++) for(int nj = -1; nj <= 1; nj++) {
                                float nn_alpha1 = 1.0;
                                for(int nni = -1; nni <= 1; nni++) for(int nnj = -1; nnj <= 1; nnj++) {
                                    if(getAlpha(neighborUv + onePixel * vec2(ni+nni, nj+nnj)) < 0.5) nn_alpha1 = 0.0;
                                }
                                if(nn_alpha1 < 0.5) n_alpha2 = 0.0;
                            }
                            if(n_alpha2 > 0.5) finalAlpha = 1.0; // If neighbor survives double erosion, dilate.
                        }
                    }
                }
            }

            // Apply the cleaned alpha mask
            texColor.a = finalAlpha;
            
            // STEP 2: Clean up internal stray pixels using the new clean mask
            if (texColor.a > 0.5) {
                vec3 dominantColor = vec3(0.0);
                float maxCount = 0.0;
                
                // Find dominant color in 3x3 neighborhood to fill holes
                for (int i = -1; i <= 1; i++) {
                    for (int j = -1; j <= 1; j++) {
                        vec2 neighborUv = vUv + onePixel * vec2(float(i), float(j));
                        vec4 neighborColor = texture2D(uTexture, neighborUv);
                        if (neighborColor.a > 0.5) {
                            float currentCount = 0.0;
                            for (int k = -1; k <= 1; k++) {
                                for (int l = -1; l <= 1; l++) {
                                     vec4 sampleColor = texture2D(uTexture, neighborUv + onePixel * vec2(float(k), float(l)));
                                     if (sampleColor.a > 0.5 && distance(neighborColor.rgb, sampleColor.rgb) < 0.1) {
                                         currentCount += 1.0;
                                     }
                                }
                            }
                            if (currentCount > maxCount) {
                                maxCount = currentCount;
                                dominantColor = neighborColor.rgb;
                            }
                        }
                    }
                }
                 // Only overwrite if a dominant color was found
                if (maxCount > 0.0) {
                    texColor.rgb = dominantColor;
                }
            }
        }

        if (texColor.a < 0.1) {
            discard;
        }

        vec3 finalColor = texColor.rgb;

        vec3 colors[5];
        colors[0] = PALETTE_FACE;
        colors[1] = PALETTE_ARMOUR;
        colors[2] = PALETTE_TRIM;
        colors[3] = PALETTE_HAIR;
        colors[4] = PALETTE_OUTLINE;

        float dists[5];
        dists[0] = distance(texColor.rgb, colors[0]);
        dists[1] = distance(texColor.rgb, colors[1]);
        dists[2] = distance(texColor.rgb, colors[2]);
        dists[3] = distance(texColor.rgb, colors[3]);
        dists[4] = distance(texColor.rgb, colors[4]);
        
        float min_dist = 10.0;
        int min_idx = -1;

        for (int i = 0; i < 5; i++) {
            if (dists[i] < min_dist) {
                min_dist = dists[i];
                min_idx = i;
            }
        }

        if (min_idx == 0) {
            if (min_dist < uThresholdFace) finalColor = uColorFace;
        } else if (min_idx == 1) {
            if (min_dist < uThresholdArmour) finalColor = uColorArmour;
        } else if (min_idx == 2) {
            if (min_dist < uThresholdTrim) finalColor = uColorTrim;
        } else if (min_idx == 3) {
            if (min_dist < uThresholdHair) finalColor = uColorHair;
        } else if (min_idx == 4) {
            if (min_dist < uThresholdOutline) finalColor = uColorOutline;
        }

        gl_FragColor = vec4(finalColor, texColor.a);
    }
`;

// Basic setup
const canvas = document.getElementById('main-canvas');
const container = document.getElementById('canvas-container');
const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
const scene = new THREE.Scene();

// Camera
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
camera.position.z = 1;

// Texture and Material
const textureLoader = new THREE.TextureLoader();
const texture = textureLoader.load('warrior.png', (loadedTexture) => {
    // Pass texture resolution to the shader
    shaderMaterial.uniforms.uResolution.value.x = loadedTexture.image.width;
    shaderMaterial.uniforms.uResolution.value.y = loadedTexture.image.height;
});
texture.magFilter = THREE.NearestFilter;
texture.minFilter = THREE.NearestFilter;

const shaderMaterial = new THREE.ShaderMaterial({
    uniforms: {
        uTexture: { value: texture },
        uResolution: { value: new THREE.Vector2(1, 1) }, // Default, will be updated on load
        uColorFace: { value: new THREE.Color('#FFFF00') },
        uColorArmour: { value: new THREE.Color('#0000FF') },
        uColorTrim: { value: new THREE.Color('#00FF00') },
        uColorHair: { value: new THREE.Color('#FF0000') },
        uColorOutline: { value: new THREE.Color('#000000') },
        uThresholdFace: { value: 1.0 },
        uThresholdArmour: { value: 1.0 },
        uThresholdTrim: { value: 1.0 },
        uThresholdHair: { value: 1.0 },
        uThresholdOutline: { value: 1.0 },
        uCleanPixels: { value: true },
    },
    vertexShader,
    fragmentShader,
    transparent: true,
});

// Geometry
const geometry = new THREE.PlaneGeometry(2, 2);
const mesh = new THREE.Mesh(geometry, shaderMaterial);
scene.add(mesh);

// Handle Resize
function resize() {
    const { clientWidth, clientHeight } = container;
    renderer.setSize(clientWidth, clientHeight, false);
    camera.updateProjectionMatrix();

    // Adjust plane to fit texture aspect ratio
    const imageAspect = 3 / 4; // width / height of the image
    const canvasAspect = clientWidth / clientHeight;
    mesh.scale.set(1, 1, 1);
    if (imageAspect > canvasAspect) {
        mesh.scale.set(1, canvasAspect / imageAspect, 1);
    } else {
        mesh.scale.set(imageAspect / canvasAspect, 1, 1);
    }
}

// Connect UI controls
const colorMappings = {
    'color-face': 'uColorFace',
    'color-armour': 'uColorArmour',
    'color-trim': 'uColorTrim',
    'color-hair': 'uColorHair',
    'color-outline': 'uColorOutline',
};

for (const [id, uniformName] of Object.entries(colorMappings)) {
    const input = document.getElementById(id);
    input.addEventListener('input', (event) => {
        shaderMaterial.uniforms[uniformName].value.set(event.target.value);
    });
}

// Connect individual slider controls
const thresholdMappings = {
    'threshold-face': 'uThresholdFace',
    'threshold-armour': 'uThresholdArmour',
    'threshold-trim': 'uThresholdTrim',
    'threshold-hair': 'uThresholdHair',
    'threshold-outline': 'uThresholdOutline',
};

for (const [id, uniformName] of Object.entries(thresholdMappings)) {
    const slider = document.getElementById(id);
    const valueSpan = document.getElementById(`threshold-value-${id.split('-')[1]}`);
    slider.addEventListener('input', (event) => {
        const threshold = parseFloat(event.target.value);
        shaderMaterial.uniforms[uniformName].value = threshold;
        if (valueSpan) {
            valueSpan.textContent = threshold.toFixed(2);
        }
    });
}

// Connect pixel cleanup toggle
const cleanPixelsToggle = document.getElementById('clean-pixels-toggle');
cleanPixelsToggle.addEventListener('change', (event) => {
    shaderMaterial.uniforms.uCleanPixels.value = event.target.checked;
});

// Remove old global slider logic if it's still there
const oldSliderControl = document.querySelector('.slider-control');
if (oldSliderControl && oldSliderControl.style.display !== 'none') {
    oldSliderControl.style.display = 'none';
}

// Animation loop
function animate() {
    requestAnimationFrame(animate);
    renderer.render(scene, camera);
}

// Initial setup
const resizeObserver = new ResizeObserver(resize);
resizeObserver.observe(container);
resize();
animate();