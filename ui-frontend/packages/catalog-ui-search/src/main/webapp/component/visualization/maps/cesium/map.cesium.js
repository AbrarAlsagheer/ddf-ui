/**
 * Copyright (c) Codice Foundation
 *
 * This is free software: you can redistribute it and/or modify it under the terms of the GNU Lesser
 * General Public License as published by the Free Software Foundation, either version 3 of the
 * License, or any later version.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without
 * even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Lesser General Public License for more details. A copy of the GNU Lesser General Public License
 * is distributed along with this program and can be found at
 * <http://www.gnu.org/licenses/lgpl.html>.
 *
 **/

const $ = require('jquery')
const _ = require('underscore')
const Map = require('../map')
const utility = require('./utility')
const DrawingUtility = require('../DrawingUtility')
const wreqr = require('../../../../js/wreqr.js')

const DrawBBox = require('../../../../js/widgets/cesium.bbox.js')
const DrawCircle = require('../../../../js/widgets/cesium.circle.js')
const DrawPolygon = require('../../../../js/widgets/cesium.polygon.js')
const DrawLine = require('../../../../js/widgets/cesium.line.js')

const properties = require('../../../../js/properties.js')
const Cesium = require('cesium')
const Turf = require('@turf/turf')
const DrawHelper = require('cesium-drawhelper/DrawHelper')
import CesiumLayerCollectionController from '../../../../js/controllers/cesium.layerCollection.controller'
const user = require('../../../singletons/user-instance.js')
const User = require('../../../../js/model/User.js')
import { Drawing } from '../../../singletons/drawing'
import { LazyQueryResult } from '../../../../js/model/LazyQueryResult/LazyQueryResult'
import { ClusterType } from '../react/geometries'

const defaultColor = '#3c6dd5'
const eyeOffset = new Cesium.Cartesian3(0, 0, 0)
const pixelOffset = new Cesium.Cartesian2(0.0, 0)

const rulerColor = new Cesium.Color(0.31, 0.43, 0.52)
const rulerPointColor = '#506f85'
const rulerLineHeight = 0

Cesium.BingMapsApi.defaultKey = properties.bingKey || 0
const imageryProviderTypes =
  CesiumLayerCollectionController.imageryProviderTypes

function setupTerrainProvider(viewer, terrainProvider) {
  if (terrainProvider == null || terrainProvider === undefined) {
    console.info(`Unknown terrain provider configuration.
              Default Cesium terrain provider will be used.`)
    return
  }
  const { type, ...terrainConfig } = terrainProvider
  const TerrainProvider = imageryProviderTypes[type]
  if (TerrainProvider === undefined) {
    console.warn(`
            Unknown terrain provider type: ${type}.
            Default Cesium terrain provider will be used.
        `)
    return
  }
  const defaultCesiumTerrainProvider = viewer.scene.terrainProvider
  const customTerrainProvider = new TerrainProvider(terrainConfig)
  customTerrainProvider.errorEvent.addEventListener((e) => {
    console.warn(`
            Issue using terrain provider: ${JSON.stringify({
              type,
              ...terrainConfig,
            })}
            Falling back to default Cesium terrain provider.
        `)
    viewer.scene.terrainProvider = defaultCesiumTerrainProvider
  })
  viewer.scene.terrainProvider = customTerrainProvider
}

function createMap(insertionElement) {
  const layerPrefs = user.get('user>preferences>mapLayers')
  User.updateMapLayers(layerPrefs)
  const layerCollectionController = new CesiumLayerCollectionController({
    collection: layerPrefs,
  })

  const viewer = layerCollectionController.makeMap({
    element: insertionElement,
    cesiumOptions: {
      sceneMode: Cesium.SceneMode.SCENE3D,
      animation: false,
      fullscreenButton: false,
      timeline: false,
      geocoder: false,
      homeButton: false,
      navigationHelpButton: false,
      sceneModePicker: false,
      selectionIndicator: false,
      infoBox: false,
      //skyBox: false,
      //skyAtmosphere: false,
      baseLayerPicker: false, // Hide the base layer picker,
      imageryProvider: false, // prevent default imagery provider
      mapMode2D: 0,
    },
  })

  const requestRender = () => {
    viewer.scene.requestRender()
  }

  wreqr.vent.on('map:requestRender', requestRender)

  // disable right click drag to zoom (context menu instead);
  viewer.scene.screenSpaceCameraController.zoomEventTypes = [
    Cesium.CameraEventType.WHEEL,
    Cesium.CameraEventType.PINCH,
  ]

  viewer.screenSpaceEventHandler.setInputAction(() => {
    if (!Drawing.isDrawing()) {
      $('body').mousedown()
    }
  }, Cesium.ScreenSpaceEventType.LEFT_DOWN)

  viewer.screenSpaceEventHandler.setInputAction(() => {
    if (!Drawing.isDrawing()) {
      $('body').mousedown()
    }
  }, Cesium.ScreenSpaceEventType.RIGHT_DOWN)

  setupTerrainProvider(viewer, properties.terrainProvider)

  return {
    map: viewer,
    requestRenderHandler: requestRender,
  }
}

function determineIdFromPosition(position, map) {
  let id
  const pickedObject = map.scene.pick(position)
  if (pickedObject) {
    id = pickedObject.id
    if (id && id.constructor === Cesium.Entity) {
      id = id.resultId
    }
  }
  return id
}

function expandRectangle(rectangle) {
  const scalingFactor = 0.05

  let widthGap = Math.abs(rectangle.east) - Math.abs(rectangle.west)
  let heightGap = Math.abs(rectangle.north) - Math.abs(rectangle.south)

  //ensure rectangle has some size
  if (widthGap === 0) {
    widthGap = 1
  }
  if (heightGap === 0) {
    heightGap = 1
  }

  rectangle.east = rectangle.east + Math.abs(scalingFactor * widthGap)
  rectangle.north = rectangle.north + Math.abs(scalingFactor * heightGap)
  rectangle.south = rectangle.south - Math.abs(scalingFactor * heightGap)
  rectangle.west = rectangle.west - Math.abs(scalingFactor * widthGap)

  return rectangle
}

function getDestinationForVisiblePan(rectangle, map) {
  let destinationForZoom = expandRectangle(rectangle)
  if (map.scene.mode === Cesium.SceneMode.SCENE3D) {
    destinationForZoom = map.camera.getRectangleCameraCoordinates(
      destinationForZoom
    )
  }
  return destinationForZoom
}

function determineCesiumColor(color) {
  return !_.isUndefined(color)
    ? Cesium.Color.fromCssColorString(color)
    : Cesium.Color.fromCssColorString(defaultColor)
}

function convertPointCoordinate(coordinate) {
  return {
    latitude: coordinate[1],
    longitude: coordinate[0],
    altitude: coordinate[2],
  }
}

function isNotVisible(cartesian3CenterOfGeometry, occluder) {
  return !occluder.isPointVisible(cartesian3CenterOfGeometry)
}

module.exports = function CesiumMap(
  insertionElement,
  selectionInterface,
  notificationEl,
  componentElement,
  mapModel
) {
  let overlays = {}
  let shapes = []
  const { map, requestRenderHandler } = createMap(insertionElement)
  const drawHelper = new DrawHelper(map)
  const billboardCollection = setupBillboardCollection()
  const labelCollection = setupLabelCollection()
  const drawingTools = setupDrawingTools(map)
  setupTooltip(map, selectionInterface)

  function updateCoordinatesTooltip(position) {
    const cartesian = map.camera.pickEllipsoid(
      position,
      map.scene.globe.ellipsoid
    )
    if (Cesium.defined(cartesian)) {
      let cartographic = Cesium.Cartographic.fromCartesian(cartesian)
      mapModel.updateMouseCoordinates({
        lat: cartographic.latitude * Cesium.Math.DEGREES_PER_RADIAN,
        lon: cartographic.longitude * Cesium.Math.DEGREES_PER_RADIAN,
      })
    } else {
      mapModel.clearMouseCoordinates()
    }
  }

  function setupTooltip(map, selectionInterface) {
    const handler = new Cesium.ScreenSpaceEventHandler(map.scene.canvas)
    handler.setInputAction((movement) => {
      $(componentElement).removeClass('has-feature')
      if (map.scene.mode === Cesium.SceneMode.MORPHING) {
        return
      }
      updateCoordinatesTooltip(movement.endPosition)
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE)
  }

  function setupDrawingTools(map) {
    return {
      bbox: new DrawBBox.Controller({
        map,
        notificationEl,
      }),
      circle: new DrawCircle.Controller({
        map,
        notificationEl,
      }),
      polygon: new DrawPolygon.Controller({
        map,
        notificationEl,
        drawHelper,
      }),
      line: new DrawLine.Controller({
        map,
        notificationEl,
        drawHelper,
      }),
    }
  }

  function setupBillboardCollection() {
    const billboardCollection = new Cesium.BillboardCollection()
    map.scene.primitives.add(billboardCollection)
    return billboardCollection
  }

  function setupLabelCollection() {
    const labelCollection = new Cesium.LabelCollection()
    map.scene.primitives.add(labelCollection)
    return labelCollection
  }

  /*
   * Returns a visible label that is in the same location as the provided label (geometryInstance) if one exists.
   * If findSelected is true, the function will also check for hidden labels in the same location but are selected.
   */
  function findOverlappingLabel(findSelected, geometry) {
    return _.find(
      mapModel.get('labels'),
      (label) =>
        label.position.x === geometry.position.x &&
        label.position.y === geometry.position.y &&
        ((findSelected && label.isSelected) || label.show)
    )
  }

  /*
      Only shows one label if there are multiple labels in the same location.

      Show the label in the following importance:
        - it is selected and the existing label is not
        - there is no other label displayed at the same location
        - it is the label that was found by findOverlappingLabel

      Arguments are:
        - the label to show/hide
        - if the label is selected
        - if the search for overlapping label should include hidden selected labels
      */
  function showHideLabel({ geometry, findSelected = false }) {
    const isSelected = geometry.isSelected
    const labelWithSamePosition = findOverlappingLabel(findSelected, geometry)
    if (
      isSelected &&
      labelWithSamePosition &&
      !labelWithSamePosition.isSelected
    ) {
      labelWithSamePosition.show = false
    }
    const otherLabelNotSelected = labelWithSamePosition
      ? !labelWithSamePosition.isSelected
      : true
    geometry.show =
      (isSelected && otherLabelNotSelected) ||
      !labelWithSamePosition ||
      geometry.id === labelWithSamePosition.id
  }

  /*
      Shows a hidden label. Used when deleting a label that is shown.
      */
  function showHiddenLabel(geometry) {
    if (!geometry.show) {
      return
    }
    const hiddenLabel = _.find(
      mapModel.get('labels'),
      (label) =>
        label.position.x === geometry.position.x &&
        label.position.y === geometry.position.y &&
        label.id !== geometry.id &&
        !label.show
    )
    if (hiddenLabel) {
      hiddenLabel.show = true
    }
  }

  const exposedMethods = _.extend({}, Map, {
    drawLine(model) {
      drawingTools.line.draw(model)
    },
    drawBbox(model) {
      drawingTools.bbox.draw(model)
    },
    drawCircle(model) {
      drawingTools.circle.draw(model)
    },
    drawPolygon(model) {
      drawingTools.polygon.draw(model)
    },
    destroyDrawingTools() {
      drawingTools.line.destroy()
      drawingTools.polygon.destroy()
      drawingTools.circle.destroy()
      drawingTools.bbox.destroy()
    },
    onLeftClick(callback) {
      $(map.scene.canvas).on('click', (e) => {
        const boundingRect = map.scene.canvas.getBoundingClientRect()
        callback(e, {
          mapTarget: determineIdFromPosition(
            {
              x: e.clientX - boundingRect.left,
              y: e.clientY - boundingRect.top,
            },
            map
          ),
        })
      })
    },
    onRightClick(callback) {
      $(map.scene.canvas).on('contextmenu', (e) => {
        callback(e)
      })
    },
    onMouseTrackingForPopup(downCallback, moveCallback, upCallback) {
      map.screenSpaceEventHandlerForPopupPreview = new Cesium.ScreenSpaceEventHandler(
        map.canvas
      )
      map.screenSpaceEventHandlerForPopupPreview.setInputAction(() => {
        downCallback()
      }, Cesium.ScreenSpaceEventType.LEFT_DOWN)
      map.screenSpaceEventHandlerForPopupPreview.setInputAction(() => {
        moveCallback()
      }, Cesium.ScreenSpaceEventType.MOUSE_MOVE)
      this.onLeftClick(upCallback)
    },
    onMouseMove(callback) {
      $(map.scene.canvas).on('mousemove', (e) => {
        const boundingRect = map.scene.canvas.getBoundingClientRect()
        callback(e, {
          mapTarget: determineIdFromPosition(
            {
              x: e.clientX - boundingRect.left,
              y: e.clientY - boundingRect.top,
            },
            map
          ),
        })
      })
    },
    timeoutIds: [],
    onCameraMoveStart(callback) {
      clearTimeout(this.timeoutId)
      this.timeoutIds.forEach((timeoutId) => {
        clearTimeout(timeoutId)
      })
      this.timeoutIds = []
      map.scene.camera.moveStart.addEventListener(callback)
    },
    offCameraMoveStart(callback) {
      map.scene.camera.moveStart.removeEventListener(callback)
    },
    onCameraMoveEnd(callback) {
      const timeoutCallback = () => {
        this.timeoutIds.push(
          setTimeout(() => {
            callback()
          }, 300)
        )
      }
      map.scene.camera.moveEnd.addEventListener(timeoutCallback)
    },
    offCameraMoveEnd(callback) {
      map.scene.camera.moveEnd.removeEventListener(callback)
    },
    doPanZoom(coords) {
      if (coords.length === 0) {
        return
      }
      const cartArray = coords.map((coord) =>
        Cesium.Cartographic.fromDegrees(
          coord[0],
          coord[1],
          map.camera._positionCartographic.height
        )
      )
      if (cartArray.length === 1) {
        const point = Cesium.Ellipsoid.WGS84.cartographicToCartesian(
          cartArray[0]
        )
        this.panToCoordinate(point, 2.0)
      } else {
        const rectangle = Cesium.Rectangle.fromCartographicArray(cartArray)
        this.panToRectangle(rectangle, {
          duration: 2.0,
          correction: 1.0,
        })
      }
    },
    panToResults(results) {
      let rectangle, cartArray, point

      cartArray = _.flatten(
        results
          .filter((result) => result.hasGeometry())
          .map(
            (result) =>
              _.map(result.getPoints('location'), (coordinate) =>
                Cesium.Cartographic.fromDegrees(
                  coordinate[0],
                  coordinate[1],
                  map.camera._positionCartographic.height
                )
              ),
            true
          )
      )

      if (cartArray.length > 0) {
        if (cartArray.length === 1) {
          point = Cesium.Ellipsoid.WGS84.cartographicToCartesian(cartArray[0])
          this.panToCoordinate(point)
        } else {
          rectangle = Cesium.Rectangle.fromCartographicArray(cartArray)
          this.panToRectangle(rectangle)
        }
      }
    },
    panToCoordinate(coords, duration = 0.5) {
      map.scene.camera.flyTo({
        duration,
        destination: coords,
      })
    },
    panToExtent(coords) {},
    panToShapesExtent() {
      let features = []

      shapes.map((shape) => {
        let feature = utility.featureFromShape(shape)

        if (utility.featureIsValid(feature)) {
          features.push(feature)
        }
      })

      if (features.length) {
        const featureCollection = Turf.featureCollection(features)
        // Turf returns bbox as [west, south, east, north], which is the order that Cesium.Rectangle expects
        const bboxExtent = Turf.bbox(featureCollection)
        const rectangle = new Cesium.Rectangle.fromDegrees(...bboxExtent)

        this.panToRectangle(rectangle)
      }
    },
    panToRectangle(
      rectangle,
      opts = {
        duration: 0.5,
        correction: 0.25,
      }
    ) {
      map.scene.camera.flyTo({
        duration: opts.duration,
        destination: getDestinationForVisiblePan(rectangle, map),
        complete() {
          map.scene.camera.flyTo({
            duration: opts.correction,
            destination: getDestinationForVisiblePan(rectangle, map),
          })
        },
      })
    },
    getShapes() {
      return shapes
    },
    zoomToExtent(coords) {},
    zoomToBoundingBox({ north, south, east, west }) {
      map.scene.camera.flyTo({
        duration: 0.5,
        destination: Cesium.Rectangle.fromDegrees(west, south, east, north),
      })
    },
    getBoundingBox() {
      const viewRectangle = map.scene.camera.computeViewRectangle()
      return _.mapObject(viewRectangle, (val, key) =>
        Cesium.Math.toDegrees(val)
      )
    },
    overlayImage(model: LazyQueryResult) {
      const metacardId = model.plain.id
      this.removeOverlay(metacardId)

      const coords = model.getPoints('location')
      const cartographics = _.map(coords, (coord) => {
        coord = convertPointCoordinate(coord)
        return Cesium.Cartographic.fromDegrees(
          coord.longitude,
          coord.latitude,
          coord.altitude
        )
      })

      const rectangle = Cesium.Rectangle.fromCartographicArray(cartographics)

      const overlayLayer = map.scene.imageryLayers.addImageryProvider(
        new Cesium.SingleTileImageryProvider({
          url: model.currentOverlayUrl,
          rectangle,
        })
      )

      overlays[metacardId] = overlayLayer
    },
    removeOverlay(metacardId) {
      if (overlays[metacardId]) {
        map.scene.imageryLayers.remove(overlays[metacardId])
        delete overlays[metacardId]
      }
    },
    removeAllOverlays() {
      for (const overlay in overlays) {
        if (overlays.hasOwnProperty(overlay)) {
          map.scene.imageryLayers.remove(overlays[overlay])
        }
      }
      overlays = {}
    },
    getCartographicCenterOfClusterInDegrees(cluster: ClusterType) {
      return utility.calculateCartographicCenterOfGeometriesInDegrees(
        cluster.results
      )
    },
    getWindowLocationsOfResults(results: LazyQueryResult[]) {
      let occluder
      if (map.scene.mode === Cesium.SceneMode.SCENE3D) {
        occluder = new Cesium.EllipsoidalOccluder(
          Cesium.Ellipsoid.WGS84,
          map.scene.camera.position
        )
      }
      return results.map((result) => {
        const cartesian3CenterOfGeometry = utility.calculateCartesian3CenterOfGeometry(
          result
        )
        if (occluder && isNotVisible(cartesian3CenterOfGeometry, occluder)) {
          return undefined
        }
        const center = utility.calculateWindowCenterOfGeometry(
          cartesian3CenterOfGeometry,
          map
        )
        if (center) {
          return [center.x, center.y]
        } else {
          return undefined
        }
      })
    },
    /*
     * Draws a marker on the map designating a start/end point for the ruler measurement. The given
     * coordinates should be an object with 'lat' and 'lon' keys with degrees values. The given
     * marker label should be a single character or digit that is displayed on the map marker.
     */
    addRulerPoint(coordinates) {
      const { lat, lon } = coordinates
      // a point requires an altitude value so just use 0
      const point = [lon, lat, 0]
      const options = {
        id: ' ',
        title: `Selected ruler coordinate`,
        image: DrawingUtility.getCircle({
          fillColor: rulerPointColor,
          icon: null,
        }),
        view: this,
      }

      return this.addPoint(point, options)
    },
    /*
     * Removes the given Billboard from the map.
     */
    removeRulerPoint(billboardRef) {
      billboardCollection.remove(billboardRef)
      map.scene.requestRender()
    },
    /*
     * Draws a line on the map between the points in the given array of points.
     */
    addRulerLine(point) {
      let startingCoordinates = mapModel.get('startingCoordinates')

      // creates an array of Cartesian3 points
      // a PolylineGeometry allows the line to follow the curvature of the surface
      map.coordArray = [
        startingCoordinates['lon'],
        startingCoordinates['lat'],
        rulerLineHeight,
        point['lon'],
        point['lat'],
        rulerLineHeight,
      ]
      return map.entities.add({
        polyline: {
          positions: new Cesium.CallbackProperty(function (time, result) {
            return Cesium.Cartesian3.fromDegreesArrayHeights(map.coordArray)
          }, false),
          width: 5,
          show: true,
          material: rulerColor,
        },
      })
    },
    /*
     * Update the position of the ruler line
     */
    setRulerLine(point) {
      let startingCoordinates = mapModel.get('startingCoordinates')
      map.coordArray = [
        startingCoordinates['lon'],
        startingCoordinates['lat'],
        rulerLineHeight,
        point['lon'],
        point['lat'],
        rulerLineHeight,
      ]
      map.scene.requestRender()
    },
    /*
     * Removes the given polyline entity from the map.
     */
    removeRulerLine(polyline) {
      map.entities.remove(polyline)
      map.scene.requestRender()
    },
    /*
            Adds a billboard point utilizing the passed in point and options.
            Options are a view to relate to, and an id, and a color.
          */
    addPointWithText(point, options, useCustomText = false) {
      const pointObject = convertPointCoordinate(point)
      const cartographicPosition = Cesium.Cartographic.fromDegrees(
        pointObject.longitude,
        pointObject.latitude,
        pointObject.altitude
      )
      let cartesianPosition = map.scene.globe.ellipsoid.cartographicToCartesian(
        cartographicPosition
      )
      const billboardRef = billboardCollection.add({
        image: undefined,
        position: cartesianPosition,
        id: options.id,
        eyeOffset,
      })
      billboardRef.unselectedImage = DrawingUtility.getCircleWithText({
        fillColor: options.color,
        text: options.id.length,
        strokeColor: 'white',
        textColor: 'white',
      })
      billboardRef.partiallySelectedImage = DrawingUtility.getCircleWithText({
        fillColor: options.color,
        text: options.id.length,
        strokeColor: 'black',
        textColor: 'white',
      })
      billboardRef.selectedImage = DrawingUtility.getCircleWithText({
        fillColor: options.color,
        text: options.id.length,
        strokeColor: 'black',
        textColor: 'black',
      })
      switch (options.isSelected) {
        case 'selected':
          billboardRef.image = billboardRef.selectedImage
          break
        case 'partially':
          billboardRef.image = billboardRef.partiallySelectedImage
          break
        case 'unselected':
          billboardRef.image = billboardRef.unselectedImage
          break
      }
      //if there is a terrain provider and no altitude has been specified, sample it from the configured terrain provider
      if (!pointObject.altitude && map.scene.terrainProvider) {
        const promise = Cesium.sampleTerrain(map.scene.terrainProvider, 5, [
          cartographicPosition,
        ])
        Cesium.when(promise, (updatedCartographic) => {
          if (updatedCartographic[0].height && !options.view.isDestroyed) {
            cartesianPosition = map.scene.globe.ellipsoid.cartographicToCartesian(
              updatedCartographic[0]
            )
            billboardRef.position = cartesianPosition
          }
        })
      }
      map.scene.requestRender()

      return billboardRef
    },
    /*
          Adds a billboard point utilizing the passed in point and options.
          Options are a view to relate to, and an id, and a color.
          */
    addPoint(point, options) {
      const pointObject = convertPointCoordinate(point)
      const cartographicPosition = Cesium.Cartographic.fromDegrees(
        pointObject.longitude,
        pointObject.latitude,
        pointObject.altitude
      )
      const cartesianPosition = map.scene.globe.ellipsoid.cartographicToCartesian(
        cartographicPosition
      )

      const billboardRef = billboardCollection.add({
        image: undefined,
        position: cartesianPosition,
        id: options.id,
        eyeOffset,
        pixelOffset,
        verticalOrigin: options.useVerticalOrigin
          ? Cesium.VerticalOrigin.BOTTOM
          : undefined,
        horizontalOrigin: options.useHorizontalOrigin
          ? Cesium.HorizontalOrigin.CENTER
          : undefined,
        view: options.view,
      })
      billboardRef.unselectedImage = DrawingUtility.getPin({
        fillColor: options.color,
        icon: options.icon,
      })
      billboardRef.selectedImage = DrawingUtility.getPin({
        fillColor: options.color,
        strokeColor: 'black',
        icon: options.icon,
      })
      billboardRef.image = options.isSelected
        ? billboardRef.selectedImage
        : billboardRef.unselectedImage
      //if there is a terrain provider and no altitude has been specified, sample it from the configured terrain provider
      if (!pointObject.altitude && map.scene.terrainProvider) {
        const promise = Cesium.sampleTerrain(map.scene.terrainProvider, 5, [
          cartographicPosition,
        ])
        Cesium.when(promise, (updatedCartographic) => {
          if (updatedCartographic[0].height && !options.view.isDestroyed) {
            billboardRef.position = map.scene.globe.ellipsoid.cartographicToCartesian(
              updatedCartographic[0]
            )
          }
        })
      }
      map.scene.requestRender()

      return billboardRef
    },
    /*
          Adds a label utilizing the passed in point and options.
          Options are a view to an id and text.
        */
    addLabel(point, options) {
      const pointObject = convertPointCoordinate(point)
      const cartographicPosition = Cesium.Cartographic.fromDegrees(
        pointObject.longitude,
        pointObject.latitude,
        pointObject.altitude
      )
      const cartesianPosition = map.scene.globe.ellipsoid.cartographicToCartesian(
        cartographicPosition
      )
      // X, Y offset values for the label
      const offset = new Cesium.Cartesian2(20, -15)
      // Cesium measurement for determining how to render the size of the label based on zoom
      const scaleZoom = new Cesium.NearFarScalar(1.5e4, 1.0, 8.0e6, 0.0)
      // Cesium measurement for determining how to render the translucency of the label based on zoom
      const translucencyZoom = new Cesium.NearFarScalar(1.5e6, 1.0, 8.0e6, 0.0)

      const labelRef = labelCollection.add({
        text: options.text,
        position: cartesianPosition,
        id: options.id,
        pixelOffset: offset,
        scale: 1.0,
        scaleByDistance: scaleZoom,
        translucencyByDistance: translucencyZoom,
        fillColor: Cesium.Color.BLACK,
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 10,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      })
      mapModel.addLabel(labelRef)

      return labelRef
    },
    /*
          Adds a polyline utilizing the passed in line and options.
          Options are a view to relate to, and an id, and a color.
        */
    addLine(line, options) {
      const lineObject = line.map((coordinate) =>
        convertPointCoordinate(coordinate)
      )
      const cartPoints = _.map(lineObject, (point) =>
        Cesium.Cartographic.fromDegrees(
          point.longitude,
          point.latitude,
          point.altitude
        )
      )
      const cartesian = map.scene.globe.ellipsoid.cartographicArrayToCartesianArray(
        cartPoints
      )

      const polylineCollection = new Cesium.PolylineCollection()
      polylineCollection.unselectedMaterial = Cesium.Material.fromType(
        'PolylineOutline',
        {
          color: determineCesiumColor(options.color),
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 4,
        }
      )
      polylineCollection.selectedMaterial = Cesium.Material.fromType(
        'PolylineOutline',
        {
          color: determineCesiumColor(options.color),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 4,
        }
      )
      const polyline = polylineCollection.add({
        width: 8,
        material: options.isSelected
          ? polylineCollection.selectedMaterial
          : polylineCollection.unselectedMaterial,
        id: options.id,
        positions: cartesian,
      })

      if (map.scene.terrainProvider) {
        const promise = Cesium.sampleTerrain(
          map.scene.terrainProvider,
          5,
          cartPoints
        )
        Cesium.when(promise, (updatedCartographic) => {
          const positions = map.scene.globe.ellipsoid.cartographicArrayToCartesianArray(
            updatedCartographic
          )
          if (updatedCartographic[0].height && !options.view.isDestroyed) {
            polyline.positions = positions
          }
        })
      }

      map.scene.primitives.add(polylineCollection)
      return polylineCollection
    },
    /*
          Adds a polygon fill utilizing the passed in polygon and options.
          Options are a view to relate to, and an id.
        */
    addPolygon(polygon, options) {
      const polygonObject = polygon.map((coordinate) =>
        convertPointCoordinate(coordinate)
      )
      const cartPoints = _.map(polygonObject, (point) =>
        Cesium.Cartographic.fromDegrees(
          point.longitude,
          point.latitude,
          point.altitude
        )
      )
      let cartesian = map.scene.globe.ellipsoid.cartographicArrayToCartesianArray(
        cartPoints
      )

      const unselectedPolygonRef = map.entities.add({
        polygon: {
          hierarchy: cartesian,
          material: new Cesium.GridMaterialProperty({
            color: Cesium.Color.WHITE,
            cellAlpha: 0.0,
            lineCount: new Cesium.Cartesian2(2, 2),
            lineThickness: new Cesium.Cartesian2(2.0, 2.0),
            lineOffset: new Cesium.Cartesian2(0.0, 0.0),
          }),
          perPositionHeight: true,
        },
        show: true,
        resultId: options.id,
        showWhenSelected: false,
      })

      const selectedPolygonRef = map.entities.add({
        polygon: {
          hierarchy: cartesian,
          material: new Cesium.GridMaterialProperty({
            color: Cesium.Color.BLACK,
            cellAlpha: 0.0,
            lineCount: new Cesium.Cartesian2(2, 2),
            lineThickness: new Cesium.Cartesian2(2.0, 2.0),
            lineOffset: new Cesium.Cartesian2(0.0, 0.0),
          }),
          perPositionHeight: true,
        },
        show: false,
        resultId: options.id,
        showWhenSelected: true,
      })

      if (map.scene.terrainProvider) {
        const promise = Cesium.sampleTerrain(
          map.scene.terrainProvider,
          5,
          cartPoints
        )
        Cesium.when(promise, (updatedCartographic) => {
          cartesian = map.scene.globe.ellipsoid.cartographicArrayToCartesianArray(
            updatedCartographic
          )
          if (updatedCartographic[0].height && !options.view.isDestroyed) {
            unselectedPolygonRef.polygon.hierarchy.setValue(cartesian)
            selectedPolygonRef.polygon.hierarchy.setValue(cartesian)
          }
        })
      }

      return [unselectedPolygonRef, selectedPolygonRef]
    },
    /*
         Updates a passed in geometry to reflect whether or not it is selected.
         Options passed in are color and isSelected.
        */
    updateCluster(geometry, options) {
      if (geometry.constructor === Array) {
        geometry.forEach((innerGeometry) => {
          this.updateCluster(innerGeometry, options)
        })
      }
      if (geometry.constructor === Cesium.Billboard) {
        switch (options.isSelected) {
          case 'selected':
            geometry.image = geometry.selectedImage
            break
          case 'partially':
            geometry.image = geometry.partiallySelectedImage
            break
          case 'unselected':
            geometry.image = geometry.unselectedImage
            break
        }
        const isSelected = options.isSelected !== 'unselected'
        geometry.eyeOffset = new Cesium.Cartesian3(0, 0, isSelected ? -1 : 0)
      } else if (geometry.constructor === Cesium.PolylineCollection) {
        geometry._polylines.forEach((polyline) => {
          polyline.material = Cesium.Material.fromType('PolylineOutline', {
            color: determineCesiumColor('rgba(0,0,0, .1)'),
            outlineColor: determineCesiumColor('rgba(255,255,255, .1)'),
            outlineWidth: 4,
          })
        })
      } else if (geometry.showWhenSelected) {
        geometry.show = options.isSelected
      } else {
        geometry.show = !options.isSelected
      }
      map.scene.requestRender()
    },
    /*
          Updates a passed in geometry to reflect whether or not it is selected.
          Options passed in are color and isSelected.
          */
    updateGeometry(geometry, options) {
      if (geometry.constructor === Array) {
        geometry.forEach((innerGeometry) => {
          this.updateGeometry(innerGeometry, options)
        })
      }
      if (geometry.constructor === Cesium.Billboard) {
        geometry.image = options.isSelected
          ? geometry.selectedImage
          : geometry.unselectedImage
        geometry.eyeOffset = new Cesium.Cartesian3(
          0,
          0,
          options.isSelected ? -1 : 0
        )
      } else if (geometry.constructor === Cesium.Label) {
        geometry.isSelected = options.isSelected
        showHideLabel({
          geometry,
        })
      } else if (geometry.constructor === Cesium.PolylineCollection) {
        geometry._polylines.forEach((polyline) => {
          polyline.material = options.isSelected
            ? geometry.selectedMaterial
            : geometry.unselectedMaterial
        })
      } else if (geometry.showWhenSelected) {
        geometry.show = options.isSelected
      } else {
        geometry.show = !options.isSelected
      }
      map.scene.requestRender()
    },
    /*
         Updates a passed in geometry to be hidden
         */
    hideGeometry(geometry) {
      if (
        geometry.constructor === Cesium.Billboard ||
        geometry.constructor === Cesium.Label
      ) {
        geometry.show = false
      } else if (geometry.constructor === Cesium.PolylineCollection) {
        geometry._polylines.forEach((polyline) => {
          polyline.show = false
        })
      }
    },
    /*
         Updates a passed in geometry to be shown
         */
    showGeometry(geometry) {
      if (geometry.constructor === Cesium.Billboard) {
        geometry.show = true
      } else if (geometry.constructor === Cesium.Label) {
        showHideLabel({
          geometry,
          findSelected: true,
        })
      } else if (geometry.constructor === Cesium.PolylineCollection) {
        geometry._polylines.forEach((polyline) => {
          polyline.show = true
        })
      }
      map.scene.requestRender()
    },
    removeGeometry(geometry) {
      billboardCollection.remove(geometry)
      labelCollection.remove(geometry)
      map.scene.primitives.remove(geometry)
      //unminified cesium chokes if you feed a geometry with id as an Array
      if (geometry.constructor === Cesium.Entity) {
        map.entities.remove(geometry)
      }
      if (geometry.constructor === Cesium.Label) {
        mapModel.removeLabel(geometry)
        showHiddenLabel(geometry)
      }
      map.scene.requestRender()
    },
    showPolygonShape(locationModel) {
      const polygon = new DrawPolygon.PolygonRenderView({
        model: locationModel,
        map,
      })
      shapes.push(polygon)
    },
    showBboxShape(locationModel) {
      const polygon = new DrawBBox.BboxView({
        model: locationModel,
        map,
      })
      shapes.push(polygon)
    },
    showCircleShape(locationModel) {
      const circle = new DrawCircle.CircleView({
        model: locationModel,
        map,
      })
      shapes.push(circle)
    },
    showLineShape(locationModel) {
      const line = new DrawLine.LineRenderView({
        model: locationModel,
        map,
      })
      shapes.push(line)
    },
    destroyShapes() {
      shapes.forEach((shape) => {
        shape.destroy()
      })
      shapes = []
      if (map && map.scene) {
        map.scene.requestRender()
      }
    },
    getMap() {
      return map
    },
    destroy() {
      wreqr.vent.off('map:requestRender', requestRenderHandler)
      this.destroyDrawingTools()
      map.destroy()
    },
  })

  return exposedMethods
}
