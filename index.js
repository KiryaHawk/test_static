let currentMinQuantity = 0;
let showGibdd = true; // флаг ГИБДД включён по умолчанию

ymaps.ready(init);

function init() {
    fetch('open.json')
        .then(response => response.json())
        .then(obj => {
            console.log('raw data:', obj);

            const searchControls = new ymaps.control.SearchControl({
                options: {
                    float: 'right',
                    noPlacemark: true
                }
            });

            // Карта
            const myMap = new ymaps.Map('map', {
                center: [55.76, 37.64],
                zoom: 7,
                controls: [searchControls]
            });

            // Убираем лишние контролы
            const removeControls = [
                'geolocationControl',
                'trafficControl',
                'fullscreenControl',
                'zoomControl',
                'rulerControl',
                'typeSelector'
            ];
            removeControls.forEach(ctrl => myMap.controls.remove(ctrl));

            // ObjectManager
            const objectManager = new ymaps.ObjectManager({
                clusterize: true,
                clusterIconLayout: 'default#pieChart'
            });

            // Границы карты
            let minLatitude = Infinity, maxLatitude = -Infinity;
            let minLongitude = Infinity, maxLongitude = -Infinity;

            // Диапазон по quantity (только для НЕ-синих точек)
            let minQuantity = Infinity;
            let maxQuantity = -Infinity;

            const validFeatures = [];

            obj.features.forEach(feature => {
                // --- координаты ---
                if (!feature.geometry || !Array.isArray(feature.geometry.coordinates)) {
                    return; // битая геометрия
                }

                const [longitude, latitude] = feature.geometry.coordinates;
                const lat = Number(latitude);
                const lon = Number(longitude);

                if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
                    return; // плохие координаты
                }

                // Яндекс ждёт [lat, lon]
                feature.geometry.coordinates = [lat, lon];

                minLatitude = Math.min(minLatitude, lat);
                maxLatitude = Math.max(maxLatitude, lat);
                minLongitude = Math.min(minLongitude, lon);
                maxLongitude = Math.max(maxLongitude, lon);

                const preset = feature.options && feature.options.preset;
                const isBlue = preset === 'islands#blueIcon';

                // --- quantity ---
                const q = extractQuantity(feature);

                if (!isBlue) {
                    // Для НЕ-синих количество обязательно
                    if (q === null) {
                        return; // выкидываем точку без количества
                    }

                    if (!feature.properties) feature.properties = {};
                    feature.properties.quantity = q;

                    if (q < minQuantity) minQuantity = q;
                    if (q > maxQuantity) maxQuantity = q;
                }

                // Синие точки (ГИБДД) добавляем всегда (даже без quantity)
                validFeatures.push(feature);
            });

            if (validFeatures.length === 0) {
                console.warn('Нет точек для отображения.');
                return;
            }

            // Если не нашлось ни одной НЕ-синей точки с количеством
            if (minQuantity === Infinity || maxQuantity === -Infinity) {
                // чтобы фильтр не падал — ставим диапазон 0–0
                minQuantity = 0;
                maxQuantity = 0;
            }

            console.log('quantity min =', minQuantity, 'max =', maxQuantity);

            // Подменяем features на отфильтрованные
            obj.features = validFeatures;

            // Добавляем на карту
            objectManager.removeAll();
            objectManager.add(obj);
            myMap.geoObjects.add(objectManager);

            // Границы карты
            if (minLatitude !== Infinity && maxLatitude !== -Infinity &&
                minLongitude !== Infinity && maxLongitude !== -Infinity) {
                const bounds = [
                    [minLatitude, minLongitude],
                    [maxLatitude, maxLongitude]
                ];
                myMap.setBounds(bounds, { checkZoomRange: true });
            }

            // Фильтр по количеству + флаг ГИБДД
            setupFilterUI(minQuantity, maxQuantity, objectManager);
        })
        .catch(err => {
            console.error('Ошибка загрузки open.json:', err);
        });
}

/**
 * Получаем количество ДК для точки:
 * 1) если есть properties.quantity — используем его;
 * 2) иначе парсим число из balloonContentBody.
 * Если ничего не нашли — возвращаем null.
 */
function extractQuantity(feature) {
    if (!feature.properties) return null;

    // 1. quantity как отдельное поле
    if (
        feature.properties.quantity !== undefined &&
        feature.properties.quantity !== null &&
        feature.properties.quantity !== ''
    ) {
        const qNum = Number(feature.properties.quantity);
        if (Number.isFinite(qNum)) return qNum;
    }

    // 2. Пытаемся достать из HTML balloonContentBody
    const body = feature.properties.balloonContentBody;
    if (typeof body === 'string') {
        // Ищем "Кол-во ДК за месяц: <span ...>ЧИСЛО"
        const re = /Кол-во\s+ДК\s+за\s+месяц:\s*<span[^>]*>([\d\s]+)/i;
        const match = body.match(re);
        if (match && match[1]) {
            const numStr = match[1].replace(/\s+/g, '');
            const q = parseInt(numStr, 10);
            if (!isNaN(q)) {
                return q;
            }
        }
    }

    return null;
}

function setupFilterUI(minQuantity, maxQuantity, objectManager) {
    const toggleBtn = document.getElementById('filter-toggle');
    const gibddToggle = document.getElementById('gibdd-toggle');
    const panel = document.getElementById('filter-panel');
    const range = document.getElementById('quantity-range');
    const input = document.getElementById('quantity-input');
    const currentValueLabel = document.getElementById('filter-current-value');

    if (!toggleBtn || !gibddToggle || !panel || !range || !input || !currentValueLabel) {
        console.warn('Элементы фильтра не найдены в DOM.');
        return;
    }

    // панель изначально скрыта
    panel.style.display = 'none';

    // если все значения одинаковые — чуть расширим диапазон,
    // чтобы ползунок был живой
    if (minQuantity === maxQuantity) {
        range.min = minQuantity;
        range.max = maxQuantity + 1;
    } else {
        range.min = minQuantity;
        range.max = maxQuantity;
    }

    range.step = 1;
    range.value = minQuantity;

    input.min = minQuantity;
    input.max = maxQuantity;
    input.step = 1;
    input.value = minQuantity;

    currentMinQuantity = minQuantity;
    updateCurrentValueLabel(minQuantity);

    // Кнопка "Фильтр по ДК" — показать/скрыть панель
    toggleBtn.addEventListener('click', () => {
        const visibleNow = panel.style.display === 'block';
        panel.style.display = visibleNow ? 'none' : 'block';
        console.log('toggle filter panel, now:', panel.style.display);
    });

    // Флаг "ГИБДД"
    showGibdd = true;
    gibddToggle.classList.add('active');

    gibddToggle.addEventListener('click', () => {
        showGibdd = !showGibdd;
        if (showGibdd) {
            gibddToggle.classList.add('active');
        } else {
            gibddToggle.classList.remove('active');
        }
        applyFilter(currentMinQuantity, objectManager);
    });

    // движение ползунка
    range.addEventListener('input', () => {
        const val = parseInt(range.value, 10);
        input.value = val;
        applyFilter(val, objectManager);
        updateCurrentValueLabel(val);
    });

    // ввод числа
    input.addEventListener('input', () => {
        let val = parseInt(input.value, 10);
        if (isNaN(val)) val = minQuantity;

        if (val < minQuantity) val = minQuantity;
        if (val > maxQuantity) val = maxQuantity;

        input.value = val;
        range.value = val;
        applyFilter(val, objectManager);
        updateCurrentValueLabel(val);
    });

    function updateCurrentValueLabel(minVal) {
        currentValueLabel.textContent = `Показываются точки с кол-вом ≥ ${minVal}`;
    }

    // первый прогон фильтра
    applyFilter(currentMinQuantity, objectManager);
}

function applyFilter(minQuantity, objectManager) {
    currentMinQuantity = minQuantity;

    if (!objectManager) return;

    objectManager.setFilter(obj => {
        const preset = obj.options && obj.options.preset;
        const isBlue = preset === 'islands#blueIcon';

        // Синие точки (ГИБДД): управляем флагом
        if (isBlue) return showGibdd;

        const q = extractQuantity(obj);
        if (q === null) return false;  // на всякий случай
        return q >= currentMinQuantity;
    });
}
