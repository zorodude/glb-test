import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const canvasEl = document.querySelector('#scene')

// Create drag-and-drop message overlay
let dropMsg = document.createElement('div');
dropMsg.id = 'drop-message';
dropMsg.textContent = 'Drag and drop a .glb or .gltf file to load';
Object.assign(dropMsg.style, {
  position: 'fixed',
  top: '25%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  background: 'rgba(0,0,0,0.7)',
  color: '#fff',
  padding: '1.5em 2.5em',
  borderRadius: '12px',
  fontSize: '1.3em',
  zIndex: 1000,
  pointerEvents: 'none',
  textAlign: 'center',
  fontFamily: 'sans-serif',
  boxShadow: '0 2px 16px rgba(0,0,0,0.3)'
});
document.body.appendChild(dropMsg);

function showDropMsg() {
  dropMsg.style.display = '';
}
function hideDropMsg() {
  dropMsg.style.display = 'none';
}
showDropMsg();
// Prevent canvas from being drag-selected or treated like an image
canvasEl.addEventListener('dragstart', (e) => e.preventDefault());
canvasEl.addEventListener('mousedown', (e) => e.preventDefault());

const scene = new THREE.Scene();

function updateCameraAndRendererSize() {
  const width = canvasEl.clientWidth;
  const height = canvasEl.clientHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}

const camera = new THREE.PerspectiveCamera(75, canvasEl.clientWidth / canvasEl.clientHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: true });
updateCameraAndRendererSize();

window.addEventListener('resize', updateCameraAndRendererSize);


const controls = new OrbitControls(camera, renderer.domElement);
camera.position.set(0, 1.5, 3);
controls.update();

const light = new THREE.HemisphereLight(0xffffff, 0x444444);
scene.add(light);

let mixer;
let animations = [];
let model;


const loader = new GLTFLoader();

function clearModel() {
  if (model) {
    scene.remove(model);
    model.traverse(child => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach(mat => mat.dispose());
        } else {
          child.material.dispose();
        }
      }
    });
    model = null;
  }
  if (mixer) {
    mixer.stopAllAction();
    mixer = null;
  }
  animations = [];
  // Clear UI
  const ui = document.getElementById('ui');
  if (ui) ui.innerHTML = '';
  showDropMsg();
}

function handleGLTFLoad(gltf) {
  clearModel();
  model = gltf.scene;
  if (!model || !(model instanceof THREE.Object3D)) {
    console.error("Loaded model is not a valid THREE.Object3D.");
    return;
  }
  // remove lights that may have been included in the .glb
  model.traverse(child => {
    if (child.isLight) {
      child.parent.remove(child);
    }
  });
  // Store original pose for reset
  storeOriginalPose(model);
  scene.add(model);
  // Compute bounding box and fit camera
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  // Calculate distance from center so model fits in view
  const maxDim = Math.max(size.x, size.y, size.z);
  const fov = camera.fov * (Math.PI / 180);
  let distance = maxDim / (2 * Math.tan(fov / 2));
  distance *= 1.5; // Add some padding
  // Set camera position
  camera.position.set(center.x, center.y + maxDim * 0.2, center.z + distance);
  camera.lookAt(center);
  controls.target.copy(center);
  controls.update();
  mixer = new THREE.AnimationMixer(model);
  animations = gltf.animations;
  console.log('animations:', animations)
  if (animations.length) {
    createUI(animations);
  }
  fillStructureTree(model, animations);
  hideDropMsg();
}

// Drag-and-drop support
window.addEventListener('dragover', e => {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
});
window.addEventListener('drop', e => {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (!file) return;
  const ext = file.name.split('.').pop().toLowerCase();
  if (ext !== 'glb' && ext !== 'gltf') {
    alert('Please drop a .glb or .gltf file');
    return;
  }
  const reader = new FileReader();
  reader.onload = function(event) {
    if (ext === 'glb') {
      loader.parse(event.target.result, '', handleGLTFLoad, err => {
        alert('Failed to load GLB: ' + err.message);
      });
    } else if (ext === 'gltf') {
      // For .gltf, need to parse as text
      loader.parse(event.target.result, '', handleGLTFLoad, err => {
        alert('Failed to load GLTF: ' + err.message);
      });
    }
  };
  if (ext === 'glb') {
    reader.readAsArrayBuffer(file);
  } else if (ext === 'gltf') {
    reader.readAsText(file);
  }
});

function createUI(animations) {
  const ui = document.getElementById('ui');
  ui.innerHTML = '';
  let activeBtn = null;
  animations.forEach((clip, index) => {
    const btn = document.createElement('button');
    btn.innerText = clip.name || `Animation ${index + 1}`;
    btn.onclick = () => {
      mixer.stopAllAction();
      const action = mixer.clipAction(clip);
      action.reset().play();
      // Highlight active button
      if (activeBtn) activeBtn.classList.remove('active');
      btn.classList.add('active');
      activeBtn = btn;
    };
    ui.appendChild(btn);
  });
  // Reset button logic
  const resetBtn = document.getElementById('reset-btn');
  if (resetBtn) {
    resetBtn.onclick = () => {
      mixer.stopAllAction();
      // Remove highlight from all animation buttons
      Array.from(ui.querySelectorAll('button')).forEach(b => b.classList.remove('active'));
      // Reset model to original pose
      if (model) {
        model.traverse(obj => {
          if (obj.isMesh || obj.isBone) {
            obj.matrix.copy(obj.userData._originalMatrix);
            obj.rotation.setFromRotationMatrix(obj.matrix);
          }
        });
        // Reset camera position
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        const fov = camera.fov * (Math.PI / 180);
        let distance = maxDim / (2 * Math.tan(fov / 2));
        distance *= 1.5;
        camera.position.set(center.x, center.y + maxDim * 0.2, center.z + distance);
        camera.lookAt(center);
        controls.target.copy(center);
        controls.update();
      }
    };
  }
}

const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();
  mixer?.update(delta);
  renderer.render(scene, camera);
}

// Store original pose for reset
function storeOriginalPose(obj) {
  obj.userData._originalMatrix = obj.matrix.clone();
  if (obj.children && obj.children.length) {
    obj.children.forEach(child => storeOriginalPose(child));
  }
}

// Model hierarchy tree for 'structure' div
function fillStructureTree(root, animations) {
  const structureDiv = document.querySelector('.structure');
  if (!structureDiv) return;
  structureDiv.innerHTML = '';
  function hasAnimationOnNode(node) {
    if (!animations) return false;
    return animations.some(clip =>
      clip.tracks.some(track => track.name.startsWith(node.name + "."))
    );
  }
  function buildTree(node) {
    const li = document.createElement('li');
    li.textContent = node.name || node.type;
    if (hasAnimationOnNode(node)) {
      li.style.color = '#14b8a6';
      li.style.fontWeight = 'bold';
      li.title = 'Has animation';
    }
    if (node.children && node.children.length) {
      const ul = document.createElement('ul');
      node.children.forEach(child => ul.appendChild(buildTree(child)));
      li.appendChild(ul);
    }
    return li;
  }
  const ul = document.createElement('ul');
  ul.appendChild(buildTree(root));
  structureDiv.appendChild(ul);
}

animate();