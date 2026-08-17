import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export interface ScanAsset {
  id: string;
  title: string;
  subtitle: string;
  url: string;
  textureUrl: string;
  tone: 'safe' | 'warning' | 'relic';
}

export function ModelViewer({ asset }: { asset: ScanAsset }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    setLoading(true);
    setFailed(false);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x07110c, 0.09);
    const camera = new THREE.PerspectiveCamera(34, 1, 0.01, 100);
    camera.position.set(3.2, 2.15, 3.8);

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.7));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.85;
    controls.minDistance = 2.1;
    controls.maxDistance = 7;

    scene.add(new THREE.HemisphereLight(0xbde5c2, 0x102015, 2.2));
    const key = new THREE.DirectionalLight(asset.tone === 'warning' ? 0xffa46b : 0xffd685, 4.2);
    key.position.set(3, 5, 4);
    scene.add(key);
    const rim = new THREE.DirectionalLight(asset.tone === 'safe' ? 0x72e6c2 : 0x8bbcff, 2.1);
    rim.position.set(-4, 1, -3);
    scene.add(rim);

    const platform = new THREE.Mesh(
      new THREE.CylinderGeometry(1.35, 1.55, 0.08, 64),
      new THREE.MeshStandardMaterial({ color: 0x14251b, metalness: 0.4, roughness: 0.78 }),
    );
    platform.position.y = -1.08;
    scene.add(platform);

    const draco = new DRACOLoader();
    draco.setDecoderPath('/draco/');
    const loader = new GLTFLoader();
    loader.setDRACOLoader(draco);
    let model: THREE.Object3D | undefined;
    const texture = new THREE.TextureLoader().load(asset.textureUrl);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.flipY = false;
    loader.load(
      asset.url,
      (gltf) => {
        model = gltf.scene;
        const bounds = new THREE.Box3().setFromObject(model);
        const size = bounds.getSize(new THREE.Vector3());
        const center = bounds.getCenter(new THREE.Vector3());
        const scale = 2.35 / Math.max(size.x, size.y, size.z, 0.001);
        model.scale.setScalar(scale);
        model.position.set(-center.x * scale, -center.y * scale - 0.05, -center.z * scale);
        const scaledBounds = new THREE.Box3().setFromObject(model);
        model.position.y += -1.02 - scaledBounds.min.y;
        model.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.castShadow = true;
            child.receiveShadow = true;
            const materials = Array.isArray(child.material) ? child.material : [child.material];
            for (const material of materials) {
              if (material instanceof THREE.MeshStandardMaterial) {
                material.map = texture;
                material.color.set(0xffffff);
                material.metalness = 0.08;
                material.roughness = 0.82;
                material.needsUpdate = true;
              }
            }
          }
        });
        scene.add(model);
        controls.target.set(0, -0.05, 0);
        controls.update();
        setLoading(false);
      },
      undefined,
      () => {
        setLoading(false);
        setFailed(true);
      },
    );

    const resize = () => {
      const width = Math.max(1, mount.clientWidth);
      const height = Math.max(1, mount.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(mount);
    let frame = 0;
    const animate = () => {
      controls.update();
      renderer.render(scene, camera);
      frame = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      draco.dispose();
      texture.dispose();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          for (const material of materials) material.dispose();
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [asset]);

  return (
    <div className={`model-stage tone-${asset.tone}`} ref={mountRef}>
      <div className="scan-lines" />
      {loading ? <div className="model-status"><i />正在重建现场模型</div> : null}
      {failed ? <div className="model-status error">模型载入失败</div> : null}
      <div className="model-caption">
        <span>LIVE FIELD SCAN · 3D</span>
        <strong>{asset.title}</strong>
        <small>{asset.subtitle}</small>
      </div>
      <div className="drag-hint">拖动旋转 · 滚轮缩放</div>
    </div>
  );
}
