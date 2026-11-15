import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
mapboxgl.accessToken = "pk.eyJ1IjoieGlhb3NpcWFxIiwiYSI6ImNtd2Z4MnhvNDA4MTQzM3B3NzV2aXN3NmQifQ.RacDsNaWWuXPjlt2-D32DA";

const map = new mapboxgl.Map({
    container: "map",
    style: "mapbox://styles/mapbox/light-v11",
    center: [-71.09415, 42.36027],
    zoom: 12,
});

map.addControl(new mapboxgl.NavigationControl(), "top-right");

// 等底图加载完成，再添加自行车道
map.on("load", async () => {
    // 1. 注册数据源
    map.addSource("boston-bike-lanes", {
        type: "geojson",
        data: "https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson",
    });

    // 2. 用这个数据源画线
    map.addLayer({
        id: "boston-bike-lanes-layer",
        type: "line",
        source: "boston-bike-lanes",
        paint: {
            "line-color": "#32a852",
            "line-width": 3,
            "line-opacity": 0.6,
        },
    });

    // Cambridge 自行车道数据
    map.addSource("cambridge-bike-lanes", {
        type: "geojson",
        data: "https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson",
    });

    // Cambridge 自行车道图层
    map.addLayer({
        id: "cambridge-bike-lanes-layer",
        type: "line",
        source: "cambridge-bike-lanes",
        paint: {
            "line-color": "#32a852",
            "line-width": 3,
            "line-opacity": 0.6,
        },
    });

    // 读取站点数据
    const jsonData = await d3.json(
        "https://dsc106.com/labs/lab07/data/bluebikes-stations.json"
    );

    // 取出站点数组
    const stations = jsonData.data.stations;

    // 加载每一趟骑行的记录
    const trips = await d3.csv(
        "https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv",
        (d) => ({
            ...d,
            started_at: new Date(d.started_at),
            ended_at: new Date(d.ended_at),
        })
    );

    console.log("Trip count:", trips.length);
    console.log("First trip:", trips[0]);

    console.log("Station count:", stations.length);
    console.log("First station:", stations[0]);

    // 按出发站分组，统计每站的出发次数
    const departures = d3.rollup(
        trips,
        (rows) => rows.length,
        (d) => d.start_station_id
    );

    // 按到达站分组，统计每站的到达次数
    const arrivals = d3.rollup(
        trips,
        (rows) => rows.length,
        (d) => d.end_station_id
    );

    // 把统计结果加到每个站点上
    stations.forEach((station) => {
        const id = station.short_name;

        station.departures = departures.get(id) ?? 0;
        station.arrivals = arrivals.get(id) ?? 0;
        station.totalTraffic = station.departures + station.arrivals;
    });

    // 把交通量转换为圆点半径
    const radiusScale = d3
        .scaleSqrt()
        .domain([0, d3.max(stations, (d) => d.totalTraffic)])
        .range([0, 25]);

    
    const colorScale = d3
        .scaleLinear()
        .domain([0, 0.5, 1])
        .range(["steelblue", "#9370db", "darkorange"]);

    
    const svg = d3
        .select(map.getCanvasContainer())
        .append("svg");

    //站点对应圆点
    const circles = svg
        .selectAll("circle")
        .data(stations)
        .join("circle")
        .attr("r", (d) => radiusScale(d.totalTraffic))
        .attr("fill", "steelblue")
        .attr("fill-opacity", 0.7)
        .attr("stroke", "white")
        .attr("stroke-width", 1);


    // 给每个圆点添加浏览器原生悬停提示
    circles
        .append("title")
        .text(
            (d) =>
                `${d.name}\n` +
                `Total traffic: ${d.totalTraffic.toLocaleString()}\n` +
                `Departures: ${d.departures.toLocaleString()}\n` +
                `Arrivals: ${d.arrivals.toLocaleString()}`
        );

    
    // 每个站点各有 1440 个格子，记录每分钟的出发量和到达量
    const trafficByStation = new Map(
        stations.map((station) => [
            station.short_name,
            {
                departures: new Float64Array(1440),
                arrivals: new Float64Array(1440),
            },
        ])
    );

    // 只遍历一次全部骑行记录
    trips.forEach((trip) => {
        const start = trafficByStation.get(trip.start_station_id);
        const end = trafficByStation.get(trip.end_station_id);

        const startMinute =
            trip.started_at.getHours() * 60 + trip.started_at.getMinutes();

        const endMinute =
            trip.ended_at.getHours() * 60 + trip.ended_at.getMinutes();

        if (start && Number.isFinite(startMinute)) {
            start.departures[startMinute]++;
        }

        if (end && Number.isFinite(endMinute)) {
            end.arrivals[endMinute]++;
        }
    });

    // 累计和：prefix[i] 表示前 i 分钟的总量
    function makePrefix(counts) {
        const prefix = new Float64Array(1441);

        for (let i = 0; i < 1440; i++) {
            prefix[i + 1] = prefix[i] + counts[i];
        }

        return prefix;
    }

    trafficByStation.forEach((traffic) => {
        traffic.departures = makePrefix(traffic.departures);
        traffic.arrivals = makePrefix(traffic.arrivals);
    });

    // 用累计和查询时间窗口，兼容跨午夜
    function countInWindow(prefix) {
        if (timeFilter === -1) return prefix[1440];

        const start = timeFilter - 60;
        const end = timeFilter + 60;

        if (start < 0) {
            return (
                prefix[end + 1] +
                prefix[1440] - prefix[start + 1440]
            );
        }

        if (end >= 1440) {
            return (
                prefix[1440] - prefix[start] +
                prefix[end - 1440 + 1]
            );
        }

        return prefix[end + 1] - prefix[start];
    }



    function updateTraffic() {
        stations.forEach((station) => {
            const traffic = trafficByStation.get(station.short_name);

            station.departures = countInWindow(traffic.departures);
            station.arrivals = countInWindow(traffic.arrivals);
            station.totalTraffic = station.departures + station.arrivals;
        });

        circles
            .attr("r", (d) => radiusScale(d.totalTraffic))
            .attr("fill", (d) => {
                const ratio = d.totalTraffic > 0
                    ? d.departures / d.totalTraffic
                    : 0.5;

                return colorScale(ratio);
            });

        circles.select("title").text(
            (d) =>
                `${d.name}\n` +
                `Total traffic: ${d.totalTraffic.toLocaleString()}\n` +
                `Departures: ${d.departures.toLocaleString()}\n` +
                `Arrivals: ${d.arrivals.toLocaleString()}`
        );
    }


    // 把经纬度转换为当前地图上的像素位置
    function updatePositions() {
        circles.each(function (station) {
            const point = map.project([station.lon, station.lat]);

            d3.select(this)
                .attr("cx", point.x)
                .attr("cy", point.y);
        });
    }

    // 初次绘制
    updatePositions();

    // 拖动、缩放或改变地图大小时，更新圆点位置
    map.on("move", updatePositions);
    map.on("resize", updatePositions);

    const timeSlider = document.getElementById("time-slider");
    const selectedTime = document.getElementById("selected-time");
    const anyTimeLabel = document.getElementById("any-time");

    let timeFilter = -1;

    // 把分钟数转换成 HH:MM
    function formatTime(minutes) {
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;

        return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
    }

    function updateTimeDisplay() {
        timeFilter = Number(timeSlider.value);

        if (timeFilter === -1) {
            selectedTime.textContent = "";
            anyTimeLabel.style.display = "block";
        } else {
            selectedTime.textContent = formatTime(timeFilter);
            anyTimeLabel.style.display = "none";
        }

        updateTraffic();
    }

    // 拖动过程中持续更新
    timeSlider.addEventListener("input", updateTimeDisplay);

    // 初始化显示
    updateTimeDisplay();
});