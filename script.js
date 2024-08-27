const audioContext = new (window.AudioContext || window.webkitAudioContext)();
let equations = [];
let isPlaying = false;
let currentStep = 0;
let intervalId;

// C major scale frequencies
const scaleFrequencies = [261.63, 293.66, 329.63, 349.23, 392.00, 440.00, 493.88, 523.25];

// Initialize chart.js for real-time equation graphing
const ctx = document.getElementById('equationGraph').getContext('2d');
let chart = new Chart(ctx, {
    type: 'line',
    data: {
        labels: Array.from({ length: 32 }, (_, i) => i),
        datasets: [{
            label: 'Equation Output',
            data: Array(32).fill(0),
            borderColor: 'rgba(75, 192, 192, 1)',
            fill: false,
            pointRadius: 2,
            tension: 0.3
        }]
    },
    options: {
        scales: {
            x: { beginAtZero: true },
            y: { beginAtZero: true }
        },
        animation: {
            duration: 0 // Disable animation for smooth updates
        }
    }
});

function createGrid(size) {
    const grid = document.getElementById('equationGrid');
    grid.innerHTML = ''; // Clear existing grid
    equations = Array(size).fill('');
    for (let i = 0; i < size; i++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = 'x';
        input.addEventListener('input', (e) => {
            equations[i] = e.target.value;
            updateGraph(e.target.value);
        });
        cell.appendChild(input);
        grid.appendChild(cell);
    }
}

function updateGrid() {
    const size = parseInt(document.getElementById('gridSize').value);
    if (size >= 1 && size <= 32) {
        createGrid(size);
        stopSequence();
    } else {
        alert('Please enter a number between 1 and 32');
    }
}

function playNote(frequency) {
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    const waveType = document.getElementById('waveType').value;
    
    oscillator.type = waveType;
    oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime);
    
    gainNode.gain.setValueAtTime(0, audioContext.currentTime);
    gainNode.gain.linearRampToValueAtTime(1, audioContext.currentTime + 0.01);
    gainNode.gain.linearRampToValueAtTime(0, audioContext.currentTime + 0.3);
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.3);
}

function playSequence() {
    const cells = document.querySelectorAll('.cell');
    cells[currentStep].classList.add('playing');
    setTimeout(() => cells[currentStep].classList.remove('playing'), 100);

    const equation = equations[currentStep];
    if (equation) {
        try {
            const scope = {
                x: currentStep,
                pi: Math.PI,
                e: Math.E,
                i: math.complex(0, 1)
            };
            const result = math.evaluate(equation, scope);
            
            let magnitude;
            if (math.typeOf(result) === 'Complex') {
                magnitude = math.abs(result);
            } else if (typeof result === 'number') {
                magnitude = Math.abs(result);
            } else {
                throw new Error('Equation must result in a number or complex number');
            }
            
            const index = Math.round(magnitude) % scaleFrequencies.length;
            playNote(scaleFrequencies[index]);
            
            updateGraph(equation);
        } catch (error) {
            console.error('Invalid equation:', error);
            showError(`Error in step ${currentStep + 1}: ${error.message}`);
        }
    }

    currentStep = (currentStep + 1) % equations.length;
}

function showError(message) {
    const errorDiv = document.getElementById('errorMessage');
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
    setTimeout(() => {
        errorDiv.style.display = 'none';
    }, 5000);
}

function updateGraph(equation) {
    const xValues = Array.from({ length: 32 }, (_, i) => i);
    const yValues = xValues.map(x => {
        try {
            const result = math.evaluate(equation, { x, pi: Math.PI, e: Math.E, i: math.complex(0, 1) });
            if (math.typeOf(result) === 'Complex') {
                return math.abs(result);
            }
            return result;
        } catch (err) {
            return null;
        }
    });
    chart.data.datasets[0].data = yValues;
    chart.update();
}

function startSequence() {
    if (!isPlaying) {
        isPlaying = true;
        const tempo = document.getElementById('tempo').value;
        const interval = (60 / tempo) * 1000 / 2; // eighth notes
        intervalId = setInterval(playSequence, interval);
    }
}

function stopSequence() {
    if (isPlaying) {
        isPlaying = false;
        clearInterval(intervalId);
        currentStep = 0;
        document.querySelectorAll('.cell').forEach(cell => cell.classList.remove('playing'));
    }
}

function toggleDarkMode() {
    document.body.classList.toggle('dark-mode');
    localStorage.setItem('darkMode', document.body.classList.contains('dark-mode'));
}

function loadDarkModePreference() {
    const darkModePreference = localStorage.getItem('darkMode');
    if (darkModePreference === 'true') {
        document.body.classList.add('dark-mode');
        document.getElementById('darkModeToggle').checked = true;
    }
}

function createHelperSection() {
    const helperDiv = document.createElement('div');
    helperDiv.id = 'helperSection';
    helperDiv.innerHTML = `
        <h3>Available Functions and Operators</h3>
        <ul>
            <li>Basic: +, -, *, /, ^, %</li>
            <li>Trigonometric: sin(x), cos(x), tan(x)</li>
            <li>Inverse trigonometric: asin(x), acos(x), atan(x)</li>
            <li>Logarithmic: log(x) (base 10), ln(x) (natural log)</li>
            <li>Exponential: exp(x), e^x</li>
            <li>Constants: pi, e</li>
            <li>Complex numbers: i (imaginary unit)</li>
            <li>Complex functions: re(z), im(z), abs(z), arg(z), conj(z)</li>
            <li>Other: abs(x), sqrt(x), round(x), floor(x), ceil(x)</li>
        </ul>
        <p>Use 'x' as the variable for the current step number.</p>
        <p>For complex numbers, the magnitude is used to determine the note played.</p>
    `;
    document.querySelector('.container').appendChild(helperDiv);
}

document.getElementById('play').addEventListener('click', startSequence);
document.getElementById('stop').addEventListener('click', stopSequence);
document.getElementById('updateGrid').addEventListener('click', updateGrid);
document.getElementById('darkModeToggle').addEventListener('change', toggleDarkMode);

const tempoSlider = document.getElementById('tempo');
const tempoValue = document.getElementById('tempoValue');
tempoSlider.addEventListener('input', (e) => {
    tempoValue.textContent = e.target.value;
    if (isPlaying) {
        stopSequence();
        startSequence();
    }
});

// Initialize the grid and load dark mode preference
createGrid(16);
loadDarkModePreference();
createHelperSection();



